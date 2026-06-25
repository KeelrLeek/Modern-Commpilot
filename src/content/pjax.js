(function () {
  // Version stamp — logged on EVERY page load (login included) so a reload is trivially verifiable
  // in the console (read for "[pjax] v…"). Bump per build alongside manifest.json so a stale/failed
  // reload is caught immediately instead of chasing a phantom bug. Keep in sync with manifest version.
  var CP_PJAX_VERSION = "0.2.191";
  try { console.log("[pjax] v" + CP_PJAX_VERSION + " loaded"); } catch (e) {}

  // Single-page sign-out: minimum time (ms) the "Signing out…" spinner stays up
  // before landing on the login, so a fast logout still reads as a smooth,
  // intentional moment instead of a flicker. See cpSignOutFetch / cpHook.
  var CP_LOGOUT_MIN_MS = 1400;

  try { history.replaceState({ cpNav: { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } } }, "", location.href); } catch (e) {}

  var onLogin =
    location.pathname.indexOf("/Login/") !== -1 ||
    !!document.querySelector('input[name="password"]');
  try {
    if (onLogin && sessionStorage.getItem("cp-last-nav"))
      sessionStorage.setItem("cp-pending-return", "1");
  } catch (e) {}

  // Harvest the live CSP nonce once (needed by reexecScripts on login pages too)
  var LIVE_NONCE = "";
  var ss = document.scripts;
  for (var i = 0; i < ss.length; i++) {
    if (ss[i].nonce) {
      LIVE_NONCE = ss[i].nonce;
      break;
    }
  }

  // Module-level pjax state (shared between cpPjaxInit and __cpPjaxMorphed)
  var cpPjaxInited = false;
  var cpSeq = 0;
  var cpLastNav = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
  var cpPopReplaying = false;
  var _orig = null;
  var cpHook = null;
  var cpSrcCollector = null;
  var cpSectionQueue = [];
  var cpSectionRunning = false;
  var cpSectionAborted = false;
  var cpConsoleObserver = null;
  var cpFrameSeq = 0;
  var cpSpEntry = null;
  // The CURRENT entity id (e.g. a user id) for the breadcrumb's last pill. Captured from each pjax swap's
  // FETCHED doc (cpHook) because after the swap the live header keeps the PREVIOUS entity (it isn't swapped)
  // and the fresh content cell has none — so neither live source is reliable. null = no pjax swap yet this
  // page load (cpBuildConsole then reads the live header, which IS fresh on an initial/recovery load).
  var cpCurEntity = null;
  var cpAggActive = false;
  var cpAggToken = null;
  var cpAggAnchorFolder = null;
  var cpAggCache = null;   // SP pre-fetch cache {folder: menuHtml|null}, filled before the page is wiped
  var cpAggReady = null;   // {folder: {promise, resolve}} — per-folder deferred so the reveal can await each
                           // folder PROGRESSIVELY as its (sequential) prefetch resolves, instead of waiting
                           // for the whole prefetch. Removes the upfront dead gap on SP/Group/User entry.
  // sidebarSig -> { groups:[{label,items:[{name,url,params}]}] } of a level's pages, harvested once its console
  // is built; powers the breadcrumb current-pill MEGA menu. PERSISTED to sessionStorage so it survives a reload
  // — otherwise landing on a sub-page after reload/recovery (no console rebuilt) leaves the menu empty.
  var cpLevelPages = (function () { try { return JSON.parse(sessionStorage.getItem("cp-level-pages")) || {}; } catch (e) { return {}; } })();
  var cpCrumbDd = null;    // the live breadcrumb dropdown element + its teardown, if open.
  var cpGridState = null;  // the redesigned search GRID's live state (data/sort/page/cols), if active.
  // Count of token-bearing POSTs currently in flight (cpFollow / cpFollowFrame). The grid's broad search
  // rotates the single-use formtokenserial on EVERY page.jsp hop, so while any of these are outstanding the
  // live token is mid-rotation. A reload/nav that POSTs in that window sends a stale token → the server
  // bounces to Login ("session timeout"). The reload handler drains this to 0 before replaying. INCLUDES an
  // aborted-but-still-resolving prior search (abort stops the LOOP, not the in-flight fetch), which the old
  // single-_searchPromise wait missed.
  var cpInflightPosts = 0;
  // RESELLER anchor reuse: the open folder cpHook just fetched to land here IS the console's anchor
  // section, so re-fetching it (the old behaviour) fired a SECOND back-to-back folder_contents on the
  // rotating single-use token → the anchor (Profile) intermittently shelled = "Couldn't load — Retry".
  // Capture that already-fetched menu once and let cpFetchSection reuse it (mirrors cpAggCache at SP).
  var cpEntryFolder = null;   // the captured anchor folder id (e.g. "R0")
  var cpEntryHtml = null;     // its menu HTML; consumed once by cpFetchSection, then nulled

  // Re-execute scripts inside a container by replacing each <script>
  // with a fresh copy that carries the live nonce.
  function reexecScripts(container) {
    var olds = Array.prototype.slice.call(container.querySelectorAll("script"));
    for (var j = 0; j < olds.length; j++) {
      var old = olds[j];
      var s = document.createElement("script");
      var attrs = old.attributes;
      for (var k = 0; k < attrs.length; k++) {
        if (attrs[k].name !== "nonce") s.setAttribute(attrs[k].name, attrs[k].value);
      }
      if (LIVE_NONCE) s.nonce = LIVE_NONCE;
      if (old.src) {
        s.src = old.src;
        if (cpSrcCollector) cpSrcCollector.push(s);
      } else {
        s.textContent = old.textContent;
      }
      try {
        old.parentNode.replaceChild(s, old);
      } catch (e) {
        console.warn("[pjax] script replace err", e);
      }
    }
    return olds.length;
  }

  /* Exposed helper: re-execute scripts inside containers with DCL/load shims. */
  window.__cpReexec = function (containers) {
    var origAdd = document.addEventListener;
    document.addEventListener = function (type, fn, opts) {
      if (type === "DOMContentLoaded" && typeof fn === "function") {
        Promise.resolve().then(function () {
          try { fn.call(document, new Event("DOMContentLoaded")); } catch (e) { console.warn("[pjax] DCL shim err", e); }
        });
        return;
      }
      return origAdd.call(this, type, fn, opts);
    };
    var origWinAdd = window.addEventListener;
    window.addEventListener = function (type, fn, opts) {
      if (type === "load" && typeof fn === "function") {
        Promise.resolve().then(function () {
          try { fn.call(window, new Event("load")); } catch (e) { console.warn("[pjax] load shim err", e); }
        });
        return;
      }
      return origWinAdd.call(this, type, fn, opts);
    };
    var total = 0;
    cpSrcCollector = [];
    for (var ci = 0; ci < containers.length; ci++) {
      total += reexecScripts(containers[ci]);
    }
    document.addEventListener = origAdd;
    window.addEventListener = origWinAdd;
    var promise = Promise.resolve(total);
    if (cpSrcCollector.length > 0) {
      promise = new Promise(function (resolve) {
        var remaining = cpSrcCollector.slice();
        var settled = false;
        function checkDone() {
          if (settled) return;
          if (remaining.length === 0) {
            settled = true;
            resolve(total);
          }
        }
        for (var si = 0; si < remaining.length; si++) {
          remaining[si].onload = function () {
            var idx = remaining.indexOf(this);
            if (idx !== -1) remaining.splice(idx, 1);
            checkDone();
          };
          remaining[si].onerror = function () {
            var idx = remaining.indexOf(this);
            if (idx !== -1) remaining.splice(idx, 1);
            checkDone();
          };
        }
        setTimeout(function () {
          if (!settled) { settled = true; resolve(total); }
        }, 4000);
      });
    }
    cpSrcCollector = null;
    return promise;
  };

  /* Exposed helper: (re-)wire pjax after a body morph. */
  window.__cpPjaxMorphed = function (nav) {
    if (!cpPjaxInited) {
      if (typeof window.redirectPost === "function") {
        cpPjaxInit();
      } else {
        console.warn("[pjax] __cpPjaxMorphed: redirectPost not available");
        return false;
      }
    }
    if (window.redirectPost !== cpHook) {
      _orig = window.redirectPost;
      window.redirectPost = cpHook;
    }
    cpLastNav = { url: nav.url, params: nav.params || {} };
    try {
      history.replaceState({ cpNav: { url: nav.url, params: nav.params || {} } }, "", nav.url);
    } catch (e) {}
    return true;
  };

  // Auto-init on pages that already have window.redirectPost (non-login).
  // On login pages, cpPjaxInit is deferred until __cpPjaxMorphed triggers it
  // after the body morph has run the app's scripts (which define redirectPost).
  if (typeof window.redirectPost === "function") {
    cpPjaxInit();
  }

  function cpPjaxInit() {
    if (cpPjaxInited) return;
    cpPjaxInited = true;

    _orig = window.redirectPost;

    function isPjaxUrl(u) {
      return (
        typeof u === "string" &&
        (u.indexOf("folder_contents.jsp") !== -1 ||
          /\/commpilot\/Reseller(?:\/[A-Za-z0-9_]+){1,2}\/(index\.jsp)?$/.test(u) ||
          // SP- and GROUP-scoped landings (list pages e.g. SP "Groups" → /ServiceProvider/Members/, GROUP
          // "Users" → /Group/Members/, AND settings-leaf pages e.g. /Group/CallingPlan/DigitStrings/,
          // /ServiceProvider/CommunicationBarring/<sub>/). These serve real content to a plain background fetch
          // (verified: list landings + a 2-segment group leaf both return content, not a shell), so they ride
          // the plain-fetch path — no iframe. One or TWO section segments (+ optional index.jsp); the dedicated
          // Modify patterns below still route the entity-entry pages to the iframe via cpNeedsFrame.
          /\/commpilot\/ServiceProvider(?:\/[A-Za-z0-9_]+){1,2}\/(index\.jsp)?$/.test(u) ||
          /\/commpilot\/Group(?:\/[A-Za-z0-9_]+){1,2}\/(index\.jsp)?$/.test(u) ||
          /\/ServiceProviders\/Modify\//.test(u) ||
          // GROUP entry (clicking a group row). The URL depends on which list you came from: the SP Groups
          // list → /ServiceProvider/Members/Modify/, the reseller Groups list → /Reseller/Groups/Modify/.
          /\/(?:ServiceProvider\/Members|Reseller\/Groups)\/Modify\//.test(u) ||
          // USER entry (clicking a user row in a group's Users list) → /Group/Members/Modify/.
          /\/Group\/Members\/Modify\//.test(u) ||
          // USER SUB-PAGES (the settings pages behind each user folder option) → /commpilot/User/<Section>/
          // (e.g. /User/Addresses/, /User/Profile/). They serve real content to a plain background fetch
          // (verified: /User/Profile/ returns the full form, not a shell), so they ride the plain-fetch path —
          // no iframe (cpNeedsFrame stays false). Content stays raw BroadSoft for now; Phase B skins it.
          /\/commpilot\/User(?:\/[A-Za-z0-9_]+){1,2}\/(index\.jsp)?$/.test(u) ||
          u.indexOf("/commpilot/Common/page.jsp") !== -1 ||
          u.indexOf("/commpilot/Common/sort.jsp") !== -1)
      );
    }

    function cpExtractStub(doc) {
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

    function cpFollow(u, p, token, depth) {
      var body = new URLSearchParams();
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) body.append(k, p[k]);
      if (token) body.append("formtokenserial", token);
      cpInflightPosts++;   // mark a token-bearing POST in flight (drained by the reload handler)
      var _settled = false, _done = function () { if (_settled) return; _settled = true; cpInflightPosts = Math.max(0, cpInflightPosts - 1); };
      return fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "same-origin"
      })
        .then(function (r) {
          console.log("[pjax] response", r.status, r.url, "(hop " + depth + ")");
          return r.text();
        })
        .then(function (html) {
          if (html.indexOf("Please login again") !== -1 || html.indexOf("not authorized to access the system") !== -1) {
            console.warn("[pjax] AUTH-FAIL response from", u, "(token …" + (token ? String(token).slice(-6) : "none") + ", hop " + depth + ")");
            return { auth: false };
          }
          var doc = new DOMParser().parseFromString(html, "text/html");
          if (doc.querySelector('td[width="82%"]')) return { doc: doc, html: html };
          var stub = cpExtractStub(doc);
          if (stub && stub.target && depth < 4) {
            console.log("[pjax] following stub ->", stub.target);
            return cpFollow(stub.target, stub.data, stub.token, depth + 1);
          }
          return { doc: doc, html: html };
        })
        .then(function (v) { _done(); return v; }, function (e) { _done(); throw e; });
    }

    // Iframe transport. At Service-Provider / Group / User levels, folder_contents.jsp returns a
    // content-less SHELL to an out-of-band fetch (XHR) but real CONTENT to a navigation. A hidden
    // sandboxed iframe IS a navigation, so it retrieves the real menu with no top-level nav/flash.
    // sandbox="allow-same-origin" (NO allow-scripts) keeps the doc readable AND neutralises the
    // page's frame-buster (which otherwise drives top.location back out). Mirrors cpFollow's
    // {doc,html}|{auth:false} contract incl. redirect-stub following (the SP "Modify" entry →
    // folder_contents 2-step), so cpHook's swap logic is identical regardless of transport.
    function cpFollowFrame(url, params, token, depth) {
      return new Promise(function (resolve) {
        var ifr = document.createElement("iframe");
        ifr.name = "cpFrame" + (++cpFrameSeq);
        ifr.setAttribute("sandbox", "allow-same-origin");
        ifr.style.cssText = "position:absolute;width:10px;height:10px;border:0;left:-9999px;top:-9999px";
        document.body.appendChild(ifr);
        cpInflightPosts++;   // a token-bearing navigation POST in flight (drained by the reload handler)
        var settled = false;
        function done(val) {
          if (settled) return;
          settled = true;
          cpInflightPosts = Math.max(0, cpInflightPosts - 1);
          try { ifr.remove(); } catch (e) {}
          resolve(val);
        }
        function post(u, p, tok, d) {
          var f = document.createElement("form");
          f.method = "POST"; f.action = u; f.target = ifr.name;
          function add(n, v) { var inp = document.createElement("input"); inp.type = "hidden"; inp.name = n; inp.value = v; f.appendChild(inp); }
          for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) add(k, p[k]);
          if (tok) add("formtokenserial", tok);
          document.body.appendChild(f);
          ifr.onload = function () {
            var html = "";
            try {
              if ((ifr.contentWindow.location.href || "") === "about:blank") return;  // initial load, ignore
              html = ifr.contentDocument.documentElement.outerHTML;
            } catch (e) { try { f.remove(); } catch (e2) {} done({ auth: false }); return; }
            try { f.remove(); } catch (e) {}
            if (!html || html.length < 300) return;
            if (html.indexOf("Please login again") !== -1 || html.indexOf("not authorized to access the system") !== -1) { done({ auth: false }); return; }
            var fdoc = new DOMParser().parseFromString(html, "text/html");
            if (fdoc.querySelector('td[width="82%"]')) { done({ doc: fdoc, html: html }); return; }
            var stub = cpExtractStub(fdoc);
            if (stub && stub.target && d < 4) { console.log("[pjax] frame stub ->", stub.target); post(stub.target, stub.data, stub.token, d + 1); return; }
            done({ doc: fdoc, html: html });
          };
          f.submit();
        }
        post(url, params || {}, token, depth || 0);
        setTimeout(function () { done({ auth: false }); }, 8000);
      });
    }

    // Which transport: iframe for the SP entry and for non-reseller folder menus (both shell out to
    // fetch); plain fetch for everything reseller (proven, leaves the working console path untouched).
    function cpNeedsFrame(url, params) {
      if (typeof url !== "string") return false;
      // Entity-context entries gate folder_contents behind a NAVIGATION (XHR shells), so use the iframe.
      if (/\/ServiceProviders\/Modify\//.test(url)) return true;                          // Service Provider entry
      if (/\/(?:ServiceProvider\/Members|Reseller\/Groups)\/Modify\//.test(url)) return true;  // Group entry (from SP or reseller list)
      if (/\/Group\/Members\/Modify\//.test(url)) return true;                            // User entry (from a group's Users list)
      // Non-reseller folder menus (S/G/… not R) also shell to XHR → iframe. Reseller (R) stays on plain fetch.
      if (url.indexOf("folder_contents.jsp") !== -1 && params && params.folder && !/^R\d+$/.test(params.folder)) return true;
      return false;
    }

    // Pipe-joined folder-name signature of a sidebar, to detect a LEVEL change (reseller ⇄ SP …).
    function cpSidebarSig(navEl) {
      if (!navEl) return "";
      var as = navEl.querySelectorAll("a.leftnavfolder, a.leftnavfolderopen");
      var out = [];
      for (var i = 0; i < as.length; i++) {
        var t = (as[i].textContent || "").trim().split(/\n/)[0].trim();
        if (t) out.push(t);
      }
      return out.join("|");
    }

    // --- AGGREGATION transport for the non-reseller (SP/Group/User) one-scroll console ----------------
    // Each folder's menu is fetched the SAME way a real sidebar click does: a BARE folder_contents POST
    // {folder:Sn, menuId} over a sandboxed same-origin iframe (cpFollowFrame → navigation semantics, returns
    // the real menu rather than the XHR shell), threading the rotating formtokenserial into the live inputs.
    // The menuId MUST be the level's real one (Service Provider = 2, reseller = 8); it comes from the
    // per-folder enumeration — a wrong menuId returns a content-less shell (this was THE bug; SP defaulted to
    // 8 → see claude-memory/gotcha-diff-request-before-theorizing). Loads run BEFORE cpBuildConsole wipes the
    // page (the wiped console DOM also shells), into cpAggCache; finalize then builds the console from cache.
    // Debug scaffolding (delay/retry/[agg] logging) + live diagnostic harnesses are archived in
    // dev-scaffolding/sp-aggregation-debug-and-diagnostics.js.
    function cpDefer() { var d = {}; d.promise = new Promise(function (r) { d.resolve = r; }); return d; }
    function cpAggBegin(anchorFolder, anchorHtml) {
      cpAggEnd();
      cpAggActive = true;
      cpAggAnchorFolder = anchorFolder || null;
      cpAggCache = {};
      cpAggReady = {};
      if (anchorFolder && anchorHtml != null) {
        cpAggCache[anchorFolder] = anchorHtml;
        cpAggReady[anchorFolder] = { promise: Promise.resolve(anchorHtml), resolve: function () {} };
      }
      var t = document.getElementsByName("formtokenserial")[0];
      cpAggToken = t ? t.value : null;
    }
    function cpAggEnd() {
      cpAggActive = false; cpAggToken = null; cpAggAnchorFolder = null; cpAggCache = null; cpAggReady = null;
    }
    function cpAggPrefetch(folders) {
      // Pre-create a deferred per non-anchor folder up front so cpAggNavigate ALWAYS has a promise to
      // return — even for a folder the reveal reaches before its sequential load has started. Each load
      // settles its own (captured) deferred, so the reveal cascades each folder in as it lands rather than
      // waiting for the whole walk (the old await-all-then-startReveal dead gap). Loads stay SEQUENTIAL —
      // they thread the rotating single-use formtokenserial, so they cannot be parallelised.
      folders.forEach(function (f) {
        if (f.folder === cpAggAnchorFolder) return;
        if (!cpAggReady[f.folder]) cpAggReady[f.folder] = cpDefer();
      });
      var seq = Promise.resolve();
      folders.forEach(function (f) {
        if (f.folder === cpAggAnchorFolder) return;   // anchor reuses its captured menu
        var deferred = cpAggReady[f.folder];           // capture THIS build's deferred (survives a cpAggEnd swap)
        seq = seq.then(function () {
          var settle = function (html) { if (cpAggCache) cpAggCache[f.folder] = html; deferred.resolve(html); };
          if (cpSectionAborted) { settle(null); return; }
          var tokEl = document.getElementsByName("formtokenserial")[0];
          var tok = (tokEl ? tokEl.value : null) || cpAggToken;
          return cpFollowFrame("/commpilot/Common/folder_contents.jsp", { folder: f.folder, menuId: f.menuId || "2" }, tok, 0)
            .then(function (res) {
              if (!res || res.auth === false || !res.doc) { settle(null); return; }
              var nt = res.doc.getElementsByName("formtokenserial")[0];
              if (nt && nt.value) { cpAggToken = nt.value; var ts = document.getElementsByName("formtokenserial"); for (var i = 0; i < ts.length; i++) ts[i].value = nt.value; }
              var td = res.doc.querySelector('td[width="82%"]');
              var n = td ? td.querySelectorAll('a.navMenuItem').length : 0;
              settle((td && n > 0) ? td.innerHTML : null);
            })
            .catch(function () { settle(null); });
        });
      });
      return seq;
    }
    function cpAggNavigate(folder) {
      // Reveal-time read: await this folder's prefetch deferred (resolves to the menu HTML, or null if it
      // shelled). The loads run in cpAggPrefetch (against the intact page); here we just wait for THIS one,
      // so a section reveals the moment its own load lands — no waiting on the rest of the walk.
      if (cpAggReady && cpAggReady[folder]) return cpAggReady[folder].promise;
      return Promise.resolve(cpAggCache ? cpAggCache[folder] : null);
    }

    // --- PRELOAD-ALL search data layer (Groups, per-group Users, any BroadWorks search list) ----------
    // The redesigned search grid harvests EVERY result client-side, then sorts/pages instantly. This is
    // the generic, level-agnostic transport (proven live in Phase 0 for reseller Groups = 142 rows/8 pages
    // ~1.65s AND a group's Users list): a single "search" mainForm POST (empty criteria ⇒ ALL rows) returns
    // page 0 + "Page 1 of M"; the rest come from a Common/page.jsp loop (value = 1..M-1) over the SAME
    // proven cpFollow PLAIN-FETCH path (reseller/group lists serve real content to a background fetch — no
    // iframe; only folder_contents/Modify shell at SP/Group/User). The single-use formtokenserial rotates
    // per request, so the loop is SEQUENTIAL and threads the fresh token out of each response.
    // The pagination descriptor {returnPage, tableName} is read from the list's OWN doPage() wiring in the
    // response (doPage passes `var parmsArray={returnPage,tableName,value}` — a variable, not an inline
    // object), so the same code serves any list without hardcoding. Returns
    //   { headers:[colName…], rows:[{cells:[txt…], drill:{url,params}}], totalPages, desc }.

    // Pagination descriptor from the results block's doPage()/doSort() scripts.
    function cpSearchDescriptor(doc) {
      var ss = doc.querySelectorAll("script"), src = "";
      for (var i = 0; i < ss.length; i++) src += (ss[i].textContent || "") + "\n";
      var m = /returnPage:\s*['"]([^'"]+)['"]\s*,\s*tableName:\s*['"]([^'"]+)['"]/.exec(src);
      return m ? { returnPage: m[1], tableName: m[2] } : null;
    }
    function cpSearchPageOf(doc) {
      var t = (doc.body ? doc.body.textContent : "") || "";
      var m = /Page\s+(\d+)\s+of\s+(\d+)/i.exec(t);
      return m ? { cur: +m[1], total: +m[2] } : null;
    }
    // The server REFUSES to return very large result sets (e.g. SP/Reseller Users) with
    // "Failed to read: [Error 4027] Please narrow your search, there are N matching records." — a valid
    // response, NOT a transport failure, so we surface it as its own state instead of "No results" / fallback.
    function cpSearchTooMany(doc) {
      var t = (doc.body ? doc.body.textContent : "") || "";
      if (!/\[?\s*Error\s*4027\s*\]?/i.test(t) && !/please\s+narrow\s+your\s+search/i.test(t)) return null;
      var m = /there\s+are\s+([\d,]+)\s+matching\s+records/i.exec(t);
      return { count: m ? +m[1].replace(/,/g, "") : null };
    }
    function cpSearchHeaders(doc) {
      return [].map.call(doc.querySelectorAll("a.listSortHeader"), function (a) {
        return (a.textContent || "").replace(/\s+/g, " ").trim();
      });
    }
    // Generic row parse: each tr[id^=Row]; cells = the a.tableLink texts (Col0..ColN); drill = the row's
    // own redirectPost(url,{params}) (whole row is clickable). In a DOMParser'd fetched doc the
    // DOMContentLoaded wiring doesn't run, so the drill is read from the inline <script> text (decoding the
    // > '>' / % '%' the server escapes the composite key with).
    function cpSearchParseRows(doc) {
      var rows = [];
      doc.querySelectorAll('tr[id^="Row"]').forEach(function (tr) {
        var cells = [].map.call(tr.querySelectorAll("a.tableLink"), function (a) {
          var t = (a.textContent || "").trim();
          return (!t && a.querySelector("img")) ? "✓" : t;   // boolean columns (e.g. In Trunk Group) render a checkmark IMAGE with no text → keep it as a ✓ marker
        });
        if (!cells.length) return;
        var m = /redirectPost\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/.exec(tr.innerHTML);
        var drill = null;
        if (m) {
          var params = {}, re = /(\w+)\s*:\s*['"]([^'"]*)['"]/g, mm;
          while ((mm = re.exec(m[2]))) params[mm[1]] = mm[2]
            .replace(/\\u003E/g, ">").replace(/\\u0025/g, "%").replace(/\\u002F/g, "/");
          drill = { url: m[1].replace(/\\u002F/g, "/"), params: params };
        }
        rows.push({ cells: cells, drill: drill });
      });
      return rows;
    }

    // Write the freshly-rotated CSRF token back into EVERY live formtokenserial input (mirrors
    // cpAggPrefetch). The preload's page.jsp loop rotates the single-use token; without writing it back the
    // page's inputs go stale, so the NEXT real POST (a row drill-in, breadcrumb/sidebar nav, or re-search)
    // posts a dead token → recovery/Login (the "timeout after browsing pages").
    function cpWriteToken(val) {
      if (!val) return;
      var ts = document.getElementsByName("formtokenserial");
      for (var i = 0; i < ts.length; i++) ts[i].value = val;
    }

    // criteria: optional [{key, op, value}] → findKeyN/findOpN/findValueN (empty/omitted ⇒ all rows).
    // opts.onPage(pageRows, pageIdx, totalPages) fires per page (render page 1 instantly, stream the rest);
    // opts.signal.aborted short-circuits the loop (a newer search supersedes this one). Rejects on a failed
    // search/auth so the caller can FALL BACK to the legacy paginated table (never strand the user).
    function cpListSearch(criteria, opts) {
      opts = opts || {};
      var landing = location.origin + location.pathname;   // mainForm posts to the current list URL
      var form = document.querySelector('form[name="mainForm"]');
      var params = {};
      if (form) new URLSearchParams(new FormData(form)).forEach(function (v, k) { params[k] = v; });
      if (criteria && criteria.length) {
        Object.keys(params).forEach(function (k) { if (/^find(Key|Op|Value)\d+$/.test(k)) delete params[k]; });
        criteria.forEach(function (c, i) {
          params["findKey" + i] = c.key;
          params["findOp" + i] = c.op || "STARTS_WITH";
          params["findValue" + i] = c.value == null ? "" : c.value;
        });
        params.rowNum = String(criteria.length - 1);
      }
      params.buttonClicked = "search";
      params.search = "Search";
      var tokEl = document.getElementsByName("formtokenserial")[0];
      var tok = tokEl ? tokEl.value : null;

      return cpFollow(landing, params, tok, 0).then(function (res) {
        if (!res || res.auth === false || !res.doc) throw new Error("[search] search POST failed/auth");
        var desc = cpSearchDescriptor(res.doc);
        var po = cpSearchPageOf(res.doc);
        var headers = cpSearchHeaders(res.doc);
        var totalPages = po ? po.total : 1;
        var all = cpSearchParseRows(res.doc);
        var nt = res.doc.getElementsByName("formtokenserial")[0]; if (nt && nt.value) { tok = nt.value; cpWriteToken(tok); }
        var tooMany = cpSearchTooMany(res.doc);
        if (tooMany) return { headers: headers, rows: [], totalPages: 1, desc: desc, tooMany: true, matchCount: tooMany.count };
        if (opts.onPage) { try { opts.onPage(all.slice(), 0, totalPages); } catch (e) {} }

        var seq = Promise.resolve();
        var cap = Math.min(totalPages, 500);   // safety bound for a pathological set
        for (var p = 1; p < cap && desc; p++) (function (p) {
          seq = seq.then(function () {
            if (opts.signal && opts.signal.aborted) return;
            return cpFollow(location.origin + "/commpilot/Common/page.jsp",
              { returnPage: desc.returnPage, tableName: desc.tableName, value: String(p) }, tok, 0)
              .then(function (r2) {
                if (!r2 || !r2.doc) { console.warn("[search] page", p, "failed"); return; }
                var pr = cpSearchParseRows(r2.doc);
                var nt2 = r2.doc.getElementsByName("formtokenserial")[0]; if (nt2 && nt2.value) { tok = nt2.value; cpWriteToken(tok); }
                all = all.concat(pr);
                if (opts.onPage) { try { opts.onPage(pr, p, totalPages); } catch (e) {} }
              });
          });
        })(p);
        return seq.then(function () { return { headers: headers, rows: all, totalPages: totalPages, desc: desc }; });
      });
    }
    // Expose for the grid builder + live diagnostics.
    window.cpListSearch = cpListSearch;

    // Feature flag for the redesigned search grid (opt-in until verified): localStorage.cpNewSearch==='1'.
    function cpNewSearchOn() { try { return localStorage.getItem("cpNewSearch") === "1"; } catch (e) { return false; } }

    // --- THE SEARCH GRID (redesign) — filter bar + preload-all + fit-to-screen + horizontal page-flip ----
    // Faithful port of the APPROVED mockup (Testing HTML Files/groups-redesign-v2.html) into the live shell.
    // Built in pjax MAIN (alongside cpListSearch + cpBuildConsole — keeps the data and DOM in one world);
    // styled by skin.css (.cp-srch-*, privileged). Gated behind localStorage.cpNewSearch==='1' for now so the
    // committed in-place list skin stays the default until verified. pjax owns html.cp-grid-on (set when the
    // grid takes over, removed on FALLBACK) and skin.js skips its legacy list skinning while it's set.
    // Inline SVGs (MAIN world has no chrome.runtime for asset urls — same approach as the breadcrumb icons).
    var CP_SVG_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
    var CP_SVG_CHEVDOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    var CP_SVG_CHEVLEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
    var CP_SVG_CHEVRIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    var CP_SVG_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5v14"/></svg>';
    var CP_SVG_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
    var CP_SVG_CHEVLEFT2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 18-6-6 6-6M11 18l-6-6 6-6"/></svg>';
    var CP_SVG_CHEVRIGHT2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 18 6-6-6-6M13 18l6-6-6-6"/></svg>';
    var CP_SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    var CP_SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    var CP_SVG_ARRUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
    var CP_SVG_ARRDOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    var CP_SVG_BUILDING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>';
    var CP_SVG_MOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/></svg>';
    var CP_SVG_FACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
    var CP_SVG_FUNNEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/></svg>';
    var CP_SVG_ID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.8"/><path d="M5.4 16c.5-1.7 5.7-1.7 6.2 0M14 9.5h4M14 13h4"/></svg>';
    var CP_SVG_SEARCHOFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M4 4 18 18"/></svg>';
    // List-page header glyphs — MIRRORS skin.js CP_ITEM_ICONS (the menu-card/sidebar registry). pjax is MAIN
    // world and can't read skin.js's copy, so the same item SVGs live here for the search-page header. Keep both
    // in sync (see [[project-submenu-icons]]). Title-keyed (lowercased); no entry ⇒ header keeps the accent bar.
    var CP_HDR_ICONS = {
      "users": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/></svg>',
      "groups": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1"/><path d="M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M17 10h2a2 2 0 0 1 2 2v1"/><path d="M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M3 13v-1a2 2 0 0 1 2 -2h2"/></svg>',
      "service providers": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l18 0"/><path d="M5 21v-14l8 -4v18"/><path d="M19 21v-10l-6 -4"/><path d="M9 9l0 .01"/><path d="M9 12l0 .01"/><path d="M9 15l0 .01"/><path d="M9 18l0 .01"/></svg>',
      "enterprises": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l5 5v7h-5v-4m0 4h-5v-7l5 -5m1 1v-6a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v17h-8"/><path d="M13 7l0 .01"/><path d="M17 7l0 .01"/><path d="M17 11l0 .01"/><path d="M17 15l0 .01"/></svg>',
      "service instances": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2l0 -10"/><path d="M7 7l0 10"/><path d="M4 8l0 8"/></svg>',
      "profile": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h2.5"/><path d="M17.001 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M19.001 15.5v1.5"/><path d="M19.001 21v1.5"/><path d="M22.032 17.25l-1.299 .75"/><path d="M17.27 20l-1.3 .75"/><path d="M15.97 17.25l1.3 .75"/><path d="M20.733 20l1.3 .75"/></svg>',
      "activation code device onboarding policies": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21h-4a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v6"/><path d="M11 4h2"/><path d="M15.5 18m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0"/><path d="M17.3 18h4"/><path d="M20 18v2"/><path d="M21.5 18v1.5"/></svg>',
      "stir-shaken": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12l0 2.5"/></svg>',
      "alternate user ids": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0v-1.5a9 9 0 1 0 -5.5 8.28"/></svg>'
    };
    function cpHeaderIcon(title) { return CP_HDR_ICONS[(title || "").trim().toLowerCase()] || ""; }

    // Per-list column treatments, keyed by the descriptor tableName (labels always come from the SERVER
    // headers, so only the visual TYPE + sort kind are configured here). Unknown lists fall back to an
    // auto-config: col 0 = id link, all-numeric columns = right-aligned number, the rest = text.
    var CP_GRID_COLS = {
      resellerGroupTable: [
        { type: "id" }, { type: "text" }, { type: "muted" },
        { type: "badge", icon: CP_SVG_BUILDING }, { type: "numpill", deflt: "25" }
      ],
      groupUserList: [
        { type: "id" }, { type: "text" }, { type: "text" }, { type: "text" },
        { type: "num" }, { type: "muted" }, { type: "text" }
      ]
    };
    function cpGridColConfig(desc, headers, rows) {
      var preset = desc && CP_GRID_COLS[desc.tableName];
      var n = headers.length || (rows[0] ? rows[0].cells.length : 0);
      var cols = [];
      for (var i = 0; i < n; i++) {
        var c = (preset && preset[i]) ? Object.create(preset[i]) : null;
        if (!c) {
          // auto: col 0 → id link; a column whose every non-empty value is numeric → number; else text.
          if (i === 0) c = { type: "id" };
          else {
            var allNum = true, any = false;
            for (var r = 0; r < rows.length; r++) {
              var v = (rows[r].cells[i] || "").trim();
              if (!v) continue; any = true;
              if (!/^[0-9.,+\-]+$/.test(v)) { allNum = false; break; }
            }
            c = { type: (any && allNum) ? "num" : "text" };
          }
        }
        c.label = headers[i] || ("Column " + (i + 1));
        c.idx = i;
        // Semantic overrides for well-known columns, applied by LABEL so they hold at every level regardless of the
        // table name (reseller / SP / per-group): never clip the phone, centre the extension, render In Trunk Group
        // as a checkmark, and give the Groups "User Limit" the centred highlight pill at the SP level too (the SP
        // Groups table isn't the resellerGroupTable preset, so it would otherwise fall to a plain right-aligned num).
        var lbl = c.label.toLowerCase();
        if (lbl === "phone number") c.type = "phone";
        else if (lbl === "extension") { c.type = "numc"; c.align = "center"; }
        else if (lbl === "in trunk group") { c.type = "check"; c.align = "center"; }
        else if (lbl === "user limit") { c.type = "numpill"; if (c.deflt == null) c.deflt = "25"; c.align = "center"; }
        c.num = (c.type === "num" || c.type === "numpill" || c.type === "numc");
        cols.push(c);
      }
      // Service Instances: the User-ID column (long name@phonenetwork.net emails) is what forces every other
      // column to clip with "…". The Name column carries the same identifying info, so DROP User ID here to give
      // the rest room. Detected by the distinctive "Service Type" column (same signal as cpGridTemplate). The
      // surviving columns keep their original .idx → cells mapping; sort resolves columns by .idx so the now
      // non-contiguous indices are fine.
      var isSI = cols.some(function (c) { return (c.label || "").toLowerCase() === "service type"; });
      if (isSI) cols = cols.filter(function (c) { return (c.label || "").toLowerCase() !== "user id"; });
      return cols;
    }

    // Builder. Replaces the legacy list content cell with the grid scaffold, preloads ALL rows via
    // cpListSearch, then renders + wires instant sort / horizontal page-flip / wheel-paginate / fit-to-screen.
    // On a preload FAILURE it removes html.cp-grid-on and re-dispatches cp:reskin so skin.js restores the
    // legacy paginated table (never strand the user).
    function cpBuildSearchGrid() {
      var cell = document.querySelector('td[width="82%"]');
      if (!cell) return;
      if (cell.querySelector(".cp-search-redesign")) return;   // already built for this page
      cpFieldMetaCache = {};   // per-group: the department list differs by page, so don't carry it across builds
      var root = document.documentElement;
      root.classList.add("cp-grid-on");

      // Title + criteria options from the live page BEFORE we wipe it.
      var title = (document.title || "").split(":").pop().trim() || "Search";
      var fieldOpts = [].map.call(document.querySelectorAll('#findKey0 option'), function (o) {
        return { value: o.value, label: (o.textContent || "").trim() };
      });
      var opOpts = [].map.call(document.querySelectorAll('#findOp0 option'), function (o) {
        return { value: o.value, label: (o.textContent || "").trim() };
      });
      if (!fieldOpts.length) fieldOpts = [{ value: "", label: "All" }];
      if (!opOpts.length) opOpts = [{ value: "STARTS_WITH", label: "Starts With" }, { value: "CONTAINS", label: "Contains" }, { value: "EQUAL_TO", label: "Equal To" }];

      // Scaffold. PRESERVE the breadcrumb band, and HIDE (do NOT detach) the legacy list markup. The legacy
      // markup CONTAINS the mainForm (with #searchTable's findKey/findOp/findValue/rowNum + the formtokenserial)
      // AND the auth links the breadcrumb is built from — detaching them broke the search POST (no criteria
      // fields → 0 rows) and the crumb. Hiding keeps them in the DOM, so cpListSearch reads the live form and
      // the breadcrumb still builds; a preload FAILURE just un-hides them.
      var crumb = cell.querySelector(".cp-breadcrumb");
      if (crumb && crumb.parentNode !== cell) cell.insertBefore(crumb, cell.firstChild);   // hoist so hiding mainForm can't hide it
      var hidden = [];
      [].slice.call(cell.children).forEach(function (ch) { if (ch !== crumb) { ch.style.display = "none"; hidden.push(ch); } });
      var wrap = document.createElement("div");
      wrap.className = "cp-search-redesign";
      wrap.innerHTML =
        '<div class="cp-srch-head">' +
          '<span class="cp-srch-bar"></span>' +
          '<div class="cp-srch-titles"><div class="cp-srch-title"></div></div>' +
          '<div class="cp-srch-headright">' +
            '<span class="cp-srch-actions"></span>' +
            '<span class="cp-srch-count"><span class="cp-srch-dot"></span><span class="cp-srch-count-n">Loading…</span></span>' +
          '</div>' +
        '</div>' +
        '<div class="cp-srch-filterbar">' +
          '<div class="cp-srch-frows"></div>' +
        '</div>' +
        '<div class="cp-srch-results">' +
          '<div class="cp-srch-dtable">' +
            '<div class="cp-srch-dhead"></div>' +
            '<div class="cp-srch-dbody"><div class="cp-srch-loading">Loading all results…</div></div>' +
          '</div>' +
          '<div class="cp-srch-tfoot">' +
            '<div class="cp-srch-pager">' +
              '<span class="cp-srch-pg-btn cp-srch-first" title="First page">' + CP_SVG_CHEVLEFT2 + '</span>' +
              '<span class="cp-srch-pg-btn cp-srch-prev" title="Previous">' + CP_SVG_CHEVLEFT + '</span>' +
              '<span class="cp-srch-pg-cur">1 / 1</span>' +
              '<span class="cp-srch-pg-btn cp-srch-next" title="Next">' + CP_SVG_CHEVRIGHT + '</span>' +
              '<span class="cp-srch-pg-btn cp-srch-last" title="Last page">' + CP_SVG_CHEVRIGHT2 + '</span>' +
              '<span class="cp-srch-goto">' +
                '<label class="cp-srch-goto-lbl">Go to</label>' +
                '<input class="cp-srch-goto-input" type="text" inputmode="numeric" maxlength="6" placeholder="#" aria-label="Go to page" />' +
                '<button type="button" class="cp-srch-goto-go">Go</button>' +
              '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      cell.appendChild(wrap);
      wrap.querySelector(".cp-srch-title").textContent = title;
      // Console-style header: swap the accent bar for the page's lavender icon glyph (registry); pages without an
      // assigned icon keep the bar as a graceful fallback.
      var hsvg = cpHeaderIcon(title);
      if (hsvg) { var hbar = wrap.querySelector(".cp-srch-bar"); if (hbar && hbar.parentNode) { var hg = document.createElement("span"); hg.className = "cp-srch-glyph"; hg.innerHTML = hsvg; hbar.parentNode.replaceChild(hg, hbar); } }

      // Grid state.
      var state = {
        wrap: wrap, cell: cell, hidden: hidden, countN: wrap.querySelector(".cp-srch-count-n"),
        all: [], cur: [], cols: [], desc: null, entity: title, phase: "initial", searched: false,
        sortK: 0, sortDir: 1, page: 0, perPage: 12,
        accum: 0, cooling: false, criteriaCount: 1, fieldOpts: fieldOpts, opOpts: opOpts
      };
      cpGridState = state;
      // Column structure read from the live legacy list NOW, so the FIRST loading skeleton can match the result
      // (same header titles + column layout) before any search has run. cpGridColConfig derives the count from
      // the real headers, so it matches whatever the result will be.
      try {
        var liveHdrs = cpSearchHeaders(document);
        if (liveHdrs && liveHdrs.length) state.skelCols = cpGridColConfig(cpSearchDescriptor(document), liveHdrs, []);
      } catch (e) { state.skelCols = null; }

      cpGridRenderFilters(state, 1);
      cpGridWireStaticHandlers(state);
      cpGridBuildActions(state);   // surface the legacy page's action buttons (Add / wizard / …) in the header

      // NO auto-load. Show the "click to search" INITIAL state — the user runs an empty "Show all"
      // (= every row, preload-all) or a criteria search; both go through cpGridLoad → skeleton → results /
      // no-match. Avoids auto-loading a huge list (esp. Users) on every visit AND the token-rotation exposure.
      cpGridShowState(state, "initial");
    }

    // Harvest the legacy page's action buttons (Add, Add Group Wizard, … — whatever this level exposes) so the
    // grid header can surface them. Generic: read the real <input class="bwbutton"> elements from the page's own
    // button bar (NOT the search-criteria buttons inside #searchTable), drop the pure-navigation ones (OK/Cancel
    // — the breadcrumb is the back action), and dedupe the top/bottom-bar duplicates by name. Returns the LIVE
    // element so a click can be forwarded to it (preserves whatever handler BroadWorks attached — proven to fire
    // and navigate in-shell even while the legacy markup is display:none).
    function cpGridHarvestActions(cell) {
      var out = [], seen = {};
      var btns = cell.querySelectorAll("input.bwbutton, input.bwbuttonNoWidth");
      [].forEach.call(btns, function (b) {
        if (b.closest && b.closest("#searchTable")) return;          // search-criteria button, not a page action
        var nm = (b.name || "").toLowerCase();
        var label = (b.value || "").trim();
        if (!label) return;
        if (/^(ok|cancel|apply)$/.test(nm) || /^(ok|cancel|apply)$/i.test(label)) return;   // nav — breadcrumb covers it
        if (/^(search)$/.test(nm) || /^(add|del|delete|remove)\d+$/.test(nm)) return;        // search submit + the +/− criterion rows (add0, del1…)
        if (/^[+\-−]$/.test(label) || /^search$/i.test(label)) return;                  // belt-and-suspenders by label
        var key = nm || label.toLowerCase();
        if (seen[key]) return;                                       // dedupe top/bottom bar duplicates
        seen[key] = 1;
        out.push({ label: label, el: b });
      });
      return out;
    }
    function cpGridBuildActions(state) {
      var host = state.wrap.querySelector(".cp-srch-actions");
      if (!host) return;
      host.innerHTML = "";
      cpGridHarvestActions(state.cell).forEach(function (a, i) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cp-srch-actbtn" + (i === 0 ? "" : " sec");   // first action = primary, rest = secondary
        if (i === 0) btn.innerHTML = CP_SVG_PLUS + "<span>" + cpEsc(a.label) + "</span>";
        else btn.textContent = a.label;
        btn.addEventListener("click", function () { try { a.el.click(); } catch (e) {} });
        host.appendChild(btn);
      });
    }

    // State machine for the results area: "initial" (click-to-search) | "loading" (skeleton) | "nomatch"
    // (minimal) | (results render through cpGridRenderHead/Static). The dhead is cleared for non-results phases.
    function cpGridShowState(state, phase, extra) {
      state.phase = phase;
      var head = state.wrap.querySelector(".cp-srch-dhead");
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      var countPill = state.wrap.querySelector(".cp-srch-count");
      head.innerHTML = ""; head.style.gridTemplateColumns = "";
      if (phase === "loading") {
        if (countPill) countPill.style.display = "";
        var n = Math.max(8, state.perPage || 12), rows = "", i, ci;
        // Mirror the RESULTS layout so the skeleton matches what loads in: the SAME header bar (titles + its
        // surface-low background) and the SAME column layout for the shimmer rows. Columns come from a prior
        // search (state.cols) or, on the first load, from the live headers captured at mount (state.skelCols).
        var skc = (state.cols && state.cols.length) ? state.cols : state.skelCols;
        if (skc && skc.length) {
          var tmpl = cpGridTemplate(skc);
          // Header bar: dark (surface-low) with shimmer PLACEHOLDERS, not the real titles — the extension is
          // shared across users, so nothing user-specific renders during loading. (skhd cells are block so the
          // % width resolves; CSP blocks inline style attrs so widths go through cpGridApplyBarWidths.)
          head.style.gridTemplateColumns = tmpl;
          head.innerHTML = skc.map(function (c) {
            var num = (c.type === "num" || c.type === "numpill");
            return '<div class="cp-srch-skhd' + (num ? " num" : "") + '"><span class="cp-srch-sk" data-w="' + (num ? 52 : 40) + '"></span></div>';
          }).join("");
          for (i = 0; i < n; i++) {
            var cells = "";
            for (ci = 0; ci < skc.length; ci++) {
              var col = skc[ci], num = (col.type === "num" || col.type === "numpill");
              var w = num ? (30 + (i * 7) % 16) : (48 + (i * 13 + ci * 29) % 42);
              cells += '<div class="cp-srch-td' + (num ? " num" : "") + '"><span class="cp-srch-sk" data-w="' + w + '"></span></div>';
            }
            rows += '<div class="cp-srch-ghostrow cp-srch-skg">' + cells + "</div>";
          }
          dbody.innerHTML = '<div class="cp-srch-skwrap">' + rows + "</div>";
          [].forEach.call(dbody.querySelectorAll(".cp-srch-skg"), function (r) { r.style.gridTemplateColumns = tmpl; });
          cpGridApplyBarWidths(head);
          cpGridApplyBarWidths(dbody);
          return;
        }
        // Fallback (no column info yet): a generic shimmer header bar + generic shimmer rows.
        head.style.gridTemplateColumns = "1fr";
        head.innerHTML = '<div class="cp-srch-skhd"><span class="cp-srch-sk" data-w="26"></span></div>';
        for (i = 0; i < n; i++) {
          var a = (2.4 + (i * 7) % 10 / 10).toFixed(2), b = (1.6 + (i * 13) % 9 / 10).toFixed(2),
              c = (1.0 + (i * 5) % 7 / 10).toFixed(2), d = (2.0 + (i * 11) % 8 / 10).toFixed(2),
              sp = (1.1 + (i * 3) % 13 / 10).toFixed(2);
          rows += '<div class="cp-srch-skrow">' +
            '<div class="cp-srch-sk" data-g="' + a + '"></div>' +
            '<div class="cp-srch-sk" data-g="' + b + '"></div>' +
            '<div class="cp-srch-sk" data-g="' + c + '"></div>' +
            '<div class="cp-srch-sk" data-g="' + d + '"></div>' +
            '<div data-g="' + sp + '"></div>' +
          '</div>';
        }
        dbody.innerHTML = '<div class="cp-srch-skwrap">' + rows + '</div>';
        cpGridApplyBarWidths(head);
        cpGridApplyBarWidths(dbody);
        return;
      }
      if (phase === "initial") {
        if (countPill) countPill.style.display = "none";
        dbody.innerHTML = '<div class="cp-srch-state">' +
          '<div class="cp-srch-state-ico">' + CP_SVG_SEARCH + '</div>' +
          '<div class="cp-srch-state-h">Search to see ' + cpEsc((state.entity || "results").toLowerCase()) + '</div>' +
          '<div class="cp-srch-state-s">Enter a value and choose a field, then Search — or show everything.</div>' +
          '<button type="button" class="cp-srch-btn cp-srch-showall">' + CP_SVG_SEARCH + '<span>Show all</span></button>' +
        '</div>';
        var sa = dbody.querySelector(".cp-srch-showall");
        if (sa) sa.addEventListener("click", function () { cpGridLoad(state, null); });
        state.wrap.querySelector(".cp-srch-pg-cur").textContent = "—";
        return;
      }
      if (phase === "nomatch") {
        if (countPill) countPill.style.display = "";
        dbody.innerHTML = '<div class="cp-srch-state cp-srch-state-min">' +
          '<div class="cp-srch-state-ico-min">' + CP_SVG_FACE + '</div>' +
          '<div class="cp-srch-state-h-min">No results found</div>' +
        '</div>';
        state.wrap.querySelector(".cp-srch-pg-cur").textContent = "0 / 0";
        return;
      }
      if (phase === "toomany") {
        // The server has matches but too many to preload in one query. Offer the deep sweep (Load all) as the
        // primary action; narrowing the filter above stays available as the alternative.
        if (countPill) countPill.style.display = "";
        var cnt = extra != null ? extra : null;
        var eta = cnt != null ? cpSweepEta(cnt) : null;
        dbody.innerHTML = '<div class="cp-srch-state cp-srch-state-warn">' +
          '<div class="cp-srch-state-ico cp-srch-state-ico-warn">' + CP_SVG_FUNNEL + '</div>' +
          '<div class="cp-srch-state-h">Too many results to preload</div>' +
          '<div class="cp-srch-state-s">' +
            (cnt != null ? 'There are <b>' + cnt.toLocaleString() + '</b> matching records. ' : 'There are too many matching records. ') +
            'Narrow the filter above, or load them all' + (eta ? ' — ' + eta : '') + '.</div>' +
          '<button type="button" class="cp-srch-btn cp-srch-loadall">' + CP_SVG_SEARCH + '<span>Load all' + (cnt != null ? ' ' + cnt.toLocaleString() : '') + '</span></button>' +
        '</div>';
        var la = dbody.querySelector(".cp-srch-loadall");
        if (la) la.addEventListener("click", function () { cpGridDeepLoad(state, state._tooManyCriteria || [], state._tooManyTotal); });
        state.wrap.querySelector(".cp-srch-pg-cur").textContent = "—";
        return;
      }
      if (phase === "sweeping") {
        // Deep sweep in progress — bar + counter + an alphabet TRACKER (current prefix char) + a live sub-prefix
        // line climb as buckets land; Cancel aborts between buckets. mode:"id" = the opt-in User-ID remainder pass.
        if (countPill) countPill.style.display = "";
        var tot = (extra && extra.total != null) ? extra.total : null;
        var idMode = !!(extra && extra.mode === "id");
        var gap = (extra && extra.gap != null) ? extra.gap : null;   // id pass: how many stragglers we're hunting (drives the title + gap-anchored counter/bar)
        // A scoped name search (one "starts with" criterion) tiles its OWN field — M → Ma, Mb, … The opt-in
        // User-ID remainder pass tiles digit-first IDs — 0-9 chips behind an "ID ›" pin. Both use the pinned
        // sub-bucket layout (vs. the whole-system alphabet) so the tracker shows what's actually being scanned.
        // extra.seed = the name query prefix; extra.crit = the human-labelled criteria chips; extra.gap = id gap.
        var seed = (extra && extra.seed) || null;
        var crit = (extra && extra.crit) || null;
        var scoped = !!(seed || idMode);
        var trackChars = idMode ? CP_SWEEP_DIGITS : (seed ? CP_SWEEP_BASE : CP_SWEEP_FULL_NOSP);   // id pass = the digit dial (IDs are phone-number-first); names use the alphabet; scoped drops the rare specials
        var trackHtml = trackChars.map(function (c) {
          var spec = !idMode && CP_SWEEP_SPECIALS.indexOf(c) >= 0;
          return '<span class="cp-srch-tk' + (spec ? ' cp-srch-tk-spec' : '') + (seed ? ' cp-srch-tk-two' : '') + '">' + (seed ? cpSweepDisp(seed) : '') + cpSweepDisp(c) + '</span>';
        }).join("");
        var critHtml = (crit && crit.length) ? '<div class="cp-srch-sweep-crit">' + crit.map(function (q) {
          return '<span class="cp-srch-sweep-critchip"><b>' + cpEsc(q.field) + '</b><i>' + cpEsc(String(q.op || "").toLowerCase()) + '</i><span>' + cpSweepDisp(q.value) + '</span></span>';
        }).join("") + '</div>' : "";
        var pinHtml = seed ? '<span class="cp-srch-sweep-pin">' + cpSweepDisp(seed) + ' ›</span>'
                           : (idMode ? '<span class="cp-srch-sweep-pin">ID ›</span>' : "");
        var idGap = (gap != null ? gap.toLocaleString() : null);
        dbody.innerHTML = '<div class="cp-srch-state cp-srch-sweep' + (scoped ? ' cp-srch-sweep-scoped' : '') + '">' +
          '<div class="cp-srch-state-ico cp-srch-state-ico-search">' + (idMode ? CP_SVG_ID : CP_SVG_SEARCH) + '</div>' +
          '<div class="cp-srch-state-h">' + (idMode ? ('Recovering the last ' + (idGap ? idGap + ' ' : '') + 'by User&nbsp;ID') : ('Loading all ' + (tot != null ? tot.toLocaleString() + ' ' : '') + 'results…')) + '</div>' +
          critHtml +
          '<div class="cp-srch-sweep-barwrap"><div class="cp-srch-sweep-fill"></div></div>' +
          '<div class="cp-srch-sweep-n">' + (idMode ? ('0 <i>of ' + (idGap || '?') + ' recovered</i>') : ('0' + (tot != null ? ' / ' + tot.toLocaleString() : ''))) + '</div>' +
          '<div class="cp-srch-sweep-trackwrap">' + pinHtml + '<div class="cp-srch-sweep-track">' + trackHtml + '</div></div>' +
          '<div class="cp-srch-sweep-sub"></div>' +
          '<div class="cp-srch-state-s">Keep this tab open and don’t reload while it loads.</div>' +
          '<button type="button" class="cp-srch-btn cp-srch-sweep-cancel">' + CP_SVG_X + '<span>Cancel</span></button>' +
        '</div>';
        var cb = dbody.querySelector(".cp-srch-sweep-cancel");
        if (cb) cb.addEventListener("click", function () { if (state._sweepAbort) { try { state._sweepAbort.abort(); } catch (e) {} } });
        // Gentle pulse on the lens (WAAPI — CSS @keyframes don't resolve for content-script elements).
        try { var _ic = dbody.querySelector(".cp-srch-state-ico-search"); if (_ic && _ic.animate) _ic.animate([{ transform: "scale(1)" }, { transform: "scale(1.09)" }, { transform: "scale(1)" }], { duration: 1700, iterations: Infinity, easing: "ease-in-out" }); } catch (e) {}
        state.wrap.querySelector(".cp-srch-pg-cur").textContent = "—";
        return;
      }
    }

    // Unified load: skeleton → preload-all (criteria or null=all) → render grid, or the minimal no-match
    // state, or fall back to the legacy table on a transport failure (never strand the user).
    function cpGridLoad(state, criteria) {
      cpGridStopRiffle(state);   // stop any in-flight riffle / decelerating scroll
      if (state._searchAbort) { try { state._searchAbort.abort(); } catch (e) {} }   // cancel a prior in-flight search
      if (state._sweepAbort) { try { state._sweepAbort.abort(); } catch (e) {} state._sweepAbort = null; }   // and any deep sweep
      var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
      state._searchAbort = ac;   // so a navigation/reload can stop the token-rotating background fetches
      var hasCriteria = !!(criteria && criteria.some(function (c) { return c.value; }));
      cpGridShowState(state, "loading");
      if (state.countN) state.countN.textContent = "Loading…";
      var streamed = 0;
      var _searchP = cpListSearch(criteria, {
        signal: ac ? ac.signal : null,
        onPage: function (pageRows) { streamed += pageRows.length; if (state.countN) state.countN.textContent = "Loading… " + streamed; }
      });
      state._searchPromise = _searchP;   // so a reload can wait for in-flight fetches to settle before navigating
      _searchP.then(function (data) {
        if (!document.contains(state.wrap)) return;   // superseded by a newer nav
        if (data.tooMany) {
          // Server refused the (too-broad) search — offer the deep sweep (preload-all via prefix bucketing)
          // instead of just "narrow your search". Stash the base criteria + total so the card's "Load all" can
          // launch cpGridDeepLoad.
          state.all = []; state.cur = []; state.page = 0; state.searched = true;
          state._tooManyCriteria = criteria || [];
          state._tooManyTotal = (data.matchCount != null ? data.matchCount : null);
          cpGridShowState(state, "toomany", data.matchCount);
          if (state.countN) state.countN.textContent = (data.matchCount != null ? data.matchCount.toLocaleString() + " matches" : "Too many");
          return;
        }
        state.all = data.rows.slice();
        state.desc = data.desc;
        state.cols = cpGridColConfig(data.desc, data.headers, data.rows);
        state.cur = state.all.slice();
        state.page = 0;
        state.searched = true;
        if (!state.all.length) {
          cpGridShowState(state, "nomatch");
          if (state.countN) state.countN.textContent = "0 results";
          return;
        }
        cpGridSortBy(state, state.sortK, state.sortDir, true);
        cpGridRenderResultsFillIn(state);   // fill the loading boxes in place, top-to-bottom, real content dropping from above
        if (state.countN) state.countN.textContent = state.all.length + (hasCriteria ? " matched" : " preloaded");
      }).catch(function (e) {
        console.warn("[search] load failed — falling back to legacy table", e);
        cpGridFallback(state);
      });
    }

    function cpGridFallback(state) {
      document.documentElement.classList.remove("cp-grid-on");
      // Un-hide the original list, then ask skin.js to skin it. A DEDICATED event (not cp:reskin) so
      // cpAutoConsole doesn't re-enter the grid builder → no loop.
      try { if (state.wrap.parentNode) state.wrap.remove(); state.hidden.forEach(function (ch) { ch.style.display = ""; }); } catch (e2) {}
      cpGridState = null;
      document.dispatchEvent(new Event("cp:skinlegacy"));
    }

    // ---- DEEP SWEEP — preload a result set larger than the server's per-search cap (≈1000) by tiling it with
    // recursive prefix buckets, each under the cap, then concatenating. STRICTLY SEQUENTIAL & token-safe: each
    // bucket is a cpListSearch that threads the rotating single-use token; opts.signal aborts between buckets
    // (concurrency would race the token → logout, the same hazard as the reload bug). Opt-in only (the 4027 card).
    var CP_SWEEP_DIGITS = "0123456789".split("");
    var CP_SWEEP_BASE = "0123456789abcdefghijklmnopqrstuvwxyz".split("");
    // Special-character fallback, tried LAST — catches names whose 1st/2nd char is punctuation/space (the
    // stragglers the alphanumeric sweep skips, e.g. "M Sandeep"). Full ASCII punctuation + SPACE, ordered common
    // name-chars first so early-exit fires before the rare ones. URLSearchParams encodes them in the POST body.
    // SPACE is special-cased in the sweep: a trailing space trims to the parent (so "m " ≡ "m"), but "m s" DOES
    // narrow — so kids() forbids two spaces in a row (the spiral) and the no-progress guard exempts a trailing
    // space so it can still reach the next char. Other server-ignored chars (% _ …) the guard abandons.
    var CP_SWEEP_SPECIALS = (" '-.,&()@#$!%^*+=<>?/:;_~" + "`{}[]|" + "\\" + "\"").split("");
    var CP_SWEEP_FULL = CP_SWEEP_BASE.concat(CP_SWEEP_SPECIALS);   // tracker + traversal order: 0-9, a-z, then specials
    var CP_SWEEP_FULL_NOSP = CP_SWEEP_FULL.filter(function (c) { return c !== " "; });
    var CP_SWEEP_MAXDEPTH = 6;   // prefix-length guard; even a huge set bottoms out under the cap long before this.

    // Prefix field: prefer First Name (hand-typed → clean 0-9/a-z spread), then Last Name, then the id column —
    // whichever this list offers and the base criteria isn't already constraining.
    function cpDeepPartitionKey(state, baseCriteria) {
      var used = {}; (baseCriteria || []).forEach(function (c) { if (c && c.value) used[c.key] = 1; });
      var have = {}; (state.fieldOpts || []).forEach(function (o) { have[o.value] = 1; });
      var pref = ["UserFirstName", "UserLastName", "UserID"];
      for (var i = 0; i < pref.length; i++) if (have[pref[i]] && !used[pref[i]]) return pref[i];
      for (var j = 0; j < (state.fieldOpts || []).length; j++) { var v = state.fieldOpts[j].value; if (v && !used[v]) return v; }
      return (state.fieldOpts && state.fieldOpts[0] && state.fieldOpts[0].value) || "UserID";
    }
    function cpDeepRowId(r) {
      if (r.drill && r.drill.params) { var p = r.drill.params; if (p.userId) return "u:" + p.userId; if (p.id) return "i:" + p.id; }
      return "c:" + ((r.cells && r.cells[0]) || "") + "|" + ((r.cells && r.cells[1]) || "");
    }
    // Human-labelled criteria for the sweep card's "echo" chips: map each {key,op} to its Field/Match dropdown label
    // (falling back to the raw value) so the loader names the search back to the user.
    function cpSweepCritChips(state, valued) {
      function lbl(opts, v) { for (var i = 0; i < (opts || []).length; i++) if (opts[i].value === v) return opts[i].label; return v; }
      return (valued || []).map(function (c) {
        return { field: lbl(state.fieldOpts, c.key), op: lbl(state.opOpts, c.op), value: c.value };
      });
    }
    function cpDeepSweep(state, baseCriteria, partKey, opts) {
      opts = opts || {};
      var all = [], seen = Object.create(null);
      var maxDepth = opts.maxDepth || CP_SWEEP_MAXDEPTH;   // remainder (User-ID) pass caps at 2 chars; name sweep goes deeper
      if (opts.seedIds) for (var s = 0; s < opts.seedIds.length; s++) seen[opts.seedIds[s]] = 1;   // remainder pass: skip already-loaded rows, collect only NEW ones
      function aborting() { return !!(opts.signal && opts.signal.aborted); }
      function reached() { return opts.target != null && all.length >= opts.target; }   // EARLY EXIT: got everyone → stop
      function halt() { return aborting() || reached(); }
      // Children of a prefix to recurse into. For numeric User-ID prefixes (phone numbers) only digits follow — a
      // letter/special after a digit (5d, 4h) never matches, so skip them. After a SPACE, drop space from the
      // children (two spaces in a row would just re-trim → spiral). Top level + word prefixes use the full set.
      function kids(prefix) {
        if (opts.numericIds && /^[0-9]+$/.test(prefix)) return CP_SWEEP_DIGITS;
        if (prefix.charAt(prefix.length - 1) === " ") return CP_SWEEP_BASE;   // after a space, only a name char follows (0-9/a-z) — never punctuation or a second space
        return CP_SWEEP_FULL;
      }
      function bucket(prefix, depth, parentCount) {
        if (halt()) return Promise.resolve();
        if (opts.onStatus) opts.onStatus(prefix);   // report the bucket we're about to search (drives the tracker)
        var crit = (baseCriteria || []).filter(function (c) { return c && c.value; })
          .concat([{ key: partKey, op: "STARTS_WITH", value: prefix }]);
        return cpListSearch(crit, {
          signal: opts.signal,
          // Dedup INCREMENTALLY (per page) so the counter is always the true unique-so-far count — never the raw
          // streamed total (which on the remainder pass is mostly already-loaded dupes → the bogus "120 found").
          onPage: function (pageRows) {
            for (var i = 0; i < pageRows.length; i++) { var k = cpDeepRowId(pageRows[i]); if (!seen[k]) { seen[k] = 1; all.push(pageRows[i]); } }
            if (opts.onProgress) opts.onProgress(all.length);
          }
        }).then(function (data) {
          if (halt() || !data) return;
          if (data.tooMany) {   // still over the cap → descend one more character
            // NO-PROGRESS GUARD: if appending this char didn't SHRINK the match count vs the parent, the server is
            // ignoring it (an SQL wildcard % _, etc.) — recursing would spiral, so abandon this twig. A real
            // narrowing char always cuts the count (its matches are a strict subset of the parent's). EXCEPTION: a
            // trailing space also doesn't narrow (it trims), but "m s" does — so let a space-ending prefix recurse
            // (kids() already blocks a second space, bounding it).
            if (parentCount != null && data.matchCount != null && data.matchCount >= parentCount && prefix.charAt(prefix.length - 1) !== " ") return;
            if (depth >= maxDepth) return;
            return kids(prefix).reduce(function (pr, ch) {
              return pr.then(function () { return halt() ? null : bucket(prefix + ch, depth + 1, data.matchCount); });
            }, Promise.resolve());
          }
          if (data.desc && !state.desc) state.desc = data.desc;
          if (data.headers && data.headers.length && !state._sweepHeaders) state._sweepHeaders = data.headers;
          if (opts.onProgress) opts.onProgress(all.length);   // reconcile (rows already deduped in onPage)
        }, function (err) { console.warn("[sweep] bucket '" + prefix + "' failed — skipping", err); });   // one bad twig doesn't strand the sweep
      }
      // Top level: whole-system starts each bucket at a single char (excluding a LEADING space — it trims → re-sweeps
      // everything); a scoped sweep seeds every bucket with the query prefix (M → Ma, Mb, …) so it tiles only the
      // query's own sub-buckets.
      var topList = opts.seedPrefix
        ? kids(opts.seedPrefix).map(function (ch) { return opts.seedPrefix + ch; })
        : CP_SWEEP_FULL_NOSP;
      return topList.reduce(function (pr, item) {
        return pr.then(function () { return halt() ? null : bucket(item, 1, null); });
      }, Promise.resolve()).then(function () { return { rows: all, aborted: aborting() }; });
    }
    // Friendly ETA for the offer card. ~count/20 page pulls + bucket-search overhead, sequential — fold both into
    // ~0.25s/page and round UP so the wait never feels worse than promised.
    function cpSweepEta(count) {
      var secs = Math.ceil(count / 20 * 0.25);
      if (secs < 45) return "~" + Math.max(5, Math.round(secs / 5) * 5) + " seconds";
      var mins = Math.ceil(secs / 60);
      return "about " + (mins <= 1 ? "a minute" : mins + " minutes");
    }
    // Launch the deep sweep from the "Load all" CTA: progress card → tile-and-stream → final grid + checksum.
    function cpGridDeepLoad(state, baseCriteria, total) {
      if (state._sweepAbort) { try { state._sweepAbort.abort(); } catch (e) {} }   // supersede any running sweep
      if (state._searchAbort) { try { state._searchAbort.abort(); } catch (e) {} }
      var myGen = state._sweepGen = (state._sweepGen || 0) + 1;   // generation guard: only the latest sweep touches the UI
      var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
      state._sweepAbort = ac;
      state.all = []; state.cur = []; state.cols = []; state.page = 0; state.searched = true; state._sweepHeaders = null;
      cpGridRemoveGapBar(state);
      // SCOPED single-field "starts with" (e.g. First Name → M): tile the SAME field by lengthening its prefix
      // (M → Ma, Mb, …) so the loader honestly scans the query's own sub-buckets, and the seed prefix REPLACES the
      // base criterion (so it isn't double-applied). Whole-system / CONTAINS / multi-field falls back to the
      // partition-by-other-field sweep. Either way echo the typed criteria so the card names the search back.
      var valued = (baseCriteria || []).filter(function (c) { return c && c.value; });
      var seedC = (valued.length === 1 && /^STARTS_WITH$/i.test(valued[0].op || "STARTS_WITH")) ? valued[0] : null;
      var partKey, sweepBase, seedPrefix = null;
      if (seedC) { partKey = seedC.key; seedPrefix = seedC.value; sweepBase = []; }
      else { partKey = cpDeepPartitionKey(state, baseCriteria); sweepBase = baseCriteria; }
      var critChips = cpSweepCritChips(state, valued);
      state._sweepSeed = seedPrefix; state._sweepMode = "name"; state._sweepPrior = 0; state._sweepPartKey = partKey;
      cpGridShowState(state, "sweeping", { total: total, seed: seedPrefix, crit: critChips });
      var sweepP = cpDeepSweep(state, sweepBase, partKey, {
        signal: ac ? ac.signal : null,
        target: total,   // EARLY EXIT: stop the moment all `total` are loaded (e.g. specials complete the set before z)
        seedPrefix: seedPrefix,   // scoped: start the top-level buckets at <seed>+char instead of a bare char
        onStatus: function (prefix) { if (myGen === state._sweepGen) cpGridSweepStatus(state, prefix); },
        onProgress: function (loaded) { if (myGen === state._sweepGen) cpGridSweepProgress(state, loaded, total); }
      });
      state._searchPromise = sweepP;
      sweepP.then(function (out) {
        if (myGen !== state._sweepGen || !document.contains(state.wrap)) return;   // superseded → ignore
        state._sweepAbort = null;
        state.all = (out && out.rows) || [];   // hand the swept rows to the grid (cpDeepSweep accumulates locally)
        if (state._sweepHeaders) state.cols = cpGridColConfig(state.desc, state._sweepHeaders, state.all);
        state.cur = state.all.slice(); state.page = 0;
        if (!state.all.length) { cpGridShowState(state, "nomatch"); if (state.countN) state.countN.textContent = "0 results"; return; }
        // Re-lay the loading skeleton (the sweep's progress card had replaced it), THEN run the normal fill-in
        // CASCADE into it — restores the "content drops from the top" reveal and clears the card in one move.
        cpGridShowState(state, "loading");
        cpGridSortBy(state, state.sortK, state.sortDir, true);
        cpGridRenderResultsFillIn(state);
        var covered = state.all.length, gap = (total != null) ? (total - covered) : 0;
        if (state.countN) state.countN.textContent = covered.toLocaleString() + (out.aborted ? " loaded (stopped)" : " loaded") + (gap > 0 ? " · " + gap.toLocaleString() + " skipped" : "");
        // A gap (names with characters the prefix charset skips) → offer the opt-in User-ID remainder pass. Not
        // when this WAS the User-ID pass (partKey UserID), nor when the user cancelled.
        if (gap > 0 && partKey !== "UserID" && !out.aborted) cpGridShowGapBar(state, baseCriteria, total, gap);
      }).catch(function (e) { console.warn("[sweep] failed — falling back", e); cpGridFallback(state); });
    }
    // Opt-in REMAINDER pass: re-tile by User ID (digits first → phone-number IDs), deduped against the rows already
    // loaded, to catch the first-name stragglers. A full second sweep (no "everyone except X" query exists), so it
    // only runs when the user asks. Adds just the new rows to the existing set.
    function cpGridDeepRemainder(state, baseCriteria, total) {
      cpGridRemoveGapBar(state);
      if (state._sweepAbort) { try { state._sweepAbort.abort(); } catch (e) {} }   // supersede any running sweep
      if (state._searchAbort) { try { state._searchAbort.abort(); } catch (e) {} }
      var myGen = state._sweepGen = (state._sweepGen || 0) + 1;
      var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
      state._sweepAbort = ac;
      var prior = state.all.slice();
      var idGap = (total != null) ? Math.max(0, total - prior.length) : null;   // the stragglers we're hunting → title + gap-anchored counter/bar
      state._sweepSeed = null; state._sweepMode = "id"; state._sweepPrior = prior.length; state._sweepGap = idGap; state._sweepPartKey = "UserID";
      var seedIds = prior.map(cpDeepRowId);
      cpGridShowState(state, "sweeping", { total: total, mode: "id", priorCount: prior.length, gap: idGap });
      var sweepP = cpDeepSweep(state, baseCriteria, "UserID", {
        signal: ac ? ac.signal : null, seedIds: seedIds, maxDepth: 2, numericIds: true,   // 2-digit (area-code) prefixes, digits-only after a number
        target: (total != null ? Math.max(0, total - prior.length) : null),   // EARLY EXIT once the gap is filled
        onStatus: function (prefix) { if (myGen === state._sweepGen) cpGridSweepStatus(state, prefix); },
        onProgress: function (found) { if (myGen === state._sweepGen) cpGridSweepProgress(state, found, total); }
      });
      state._searchPromise = sweepP;
      sweepP.then(function (out) {
        if (myGen !== state._sweepGen || !document.contains(state.wrap)) return;   // superseded → ignore
        state._sweepAbort = null;
        var added = (out && out.rows) || [];
        state.all = prior.concat(added);
        if ((!state.cols || !state.cols.length) && state._sweepHeaders) state.cols = cpGridColConfig(state.desc, state._sweepHeaders, state.all);
        state.cur = state.all.slice(); state.page = 0;
        var covered = state.all.length, stillGap = (total != null) ? (total - covered) : 0;
        if (state.countN) state.countN.textContent = covered.toLocaleString() + " loaded" + (added.length ? " · +" + added.length.toLocaleString() + " by ID" : "") + (stillGap > 0 ? " · " + stillGap.toLocaleString() + " missing" : "");
        // Name the recovered users before dropping into the grid — only when some were actually found. When the
        // pass ran to completion and recovered NONE, show a distinct "no matches by User ID" end-state (don't just
        // silently drop into the grid). A cancelled pass falls straight through to the grid (no verdict to show).
        if (added.length && !out.aborted) { cpGridShowRecovered(state, added, covered, stillGap); }
        else if (!added.length && !out.aborted) { cpGridShowNoneRecovered(state, covered, stillGap); }
        else { cpGridShowState(state, "loading"); cpGridSortBy(state, state.sortK, state.sortDir, true); cpGridRenderResultsFillIn(state); }
      }).catch(function (e) { console.warn("[sweep] ID remainder failed", e); });
    }
    // Name the users the User-ID pass recovered (their punctuation first names tripped the name scan), with a
    // button to continue into the grid. Rendered in dbody like the other state cards.
    function cpGridShowRecovered(state, added, covered, stillGap) {
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      var head = state.wrap.querySelector(".cp-srch-dhead");
      if (head) { head.innerHTML = ""; head.style.gridTemplateColumns = ""; }
      var cols = state.cols || [], deflt = ["User ID", "Last name", "First name"];
      var labels = [0, 1, 2].map(function (i) { return (cols[i] && cols[i].label) || deflt[i]; });
      var rowsHtml = added.slice(0, 200).map(function (r) {
        var c = r.cells || [];
        return '<div class="cp-srch-rec-row"><span class="cp-srch-rec-id">' + cpEsc(c[0] || "") + '</span><span>' + cpEsc(c[1] || "") + '</span><span class="cp-srch-rec-fn">' + cpEsc(c[2] || "") + '</span></div>';
      }).join("");
      var more = added.length > 200 ? '<div class="cp-srch-rec-more">…and ' + (added.length - 200).toLocaleString() + ' more</div>' : "";
      dbody.innerHTML = '<div class="cp-srch-state cp-srch-rec">' +
        '<div class="cp-srch-state-ico cp-srch-rec-ico">' + CP_SVG_CHECK + '</div>' +
        '<div class="cp-srch-state-h">Recovered ' + added.length.toLocaleString() + ' user' + (added.length === 1 ? '' : 's') + ' by ID</div>' +
        '<div class="cp-srch-state-s">Found by User ID — their first names use characters the name scan skips.' + (stillGap > 0 ? ' ' + stillGap.toLocaleString() + ' still couldn’t be matched.' : '') + '</div>' +
        '<div class="cp-srch-rec-list"><div class="cp-srch-rec-row cp-srch-rec-head"><span>' + cpEsc(labels[0]) + '</span><span>' + cpEsc(labels[1]) + '</span><span>' + cpEsc(labels[2]) + '</span></div>' + rowsHtml + more + '</div>' +
        '<button type="button" class="cp-srch-btn cp-srch-rec-go">' + CP_SVG_CHEVRIGHT + '<span>View all ' + covered.toLocaleString() + ' in the list</span></button>' +
      '</div>';
      var go = dbody.querySelector(".cp-srch-rec-go");
      if (go) go.addEventListener("click", function () { cpGridShowState(state, "loading"); cpGridSortBy(state, state.sortK, state.sortDir, true); cpGridRenderResultsFillIn(state); });
      state.wrap.querySelector(".cp-srch-pg-cur").textContent = "—";
    }
    // The User-ID pass ran to completion and recovered NOBODY. Give the search a clear verdict (amber, honest —
    // the stragglers are genuinely still missing) with a single button into the list, mirroring cpGridShowRecovered.
    function cpGridShowNoneRecovered(state, covered, stillGap) {
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      var head = state.wrap.querySelector(".cp-srch-dhead");
      if (head) { head.innerHTML = ""; head.style.gridTemplateColumns = ""; }
      var miss = (stillGap != null && stillGap > 0)
        ? ('these ' + stillGap.toLocaleString() + ' user' + (stillGap === 1 ? '' : 's') + ' couldn’t be recovered')
        : 'no extra users could be recovered';
      dbody.innerHTML = '<div class="cp-srch-state cp-srch-state-warn">' +
        '<div class="cp-srch-state-ico cp-srch-state-ico-warn">' + CP_SVG_SEARCHOFF + '</div>' +
        '<div class="cp-srch-state-h">No matches by User&nbsp;ID</div>' +
        '<div class="cp-srch-state-s">Searched every ID prefix — ' + miss + '.</div>' +
        '<button type="button" class="cp-srch-btn cp-srch-rec-go">' + CP_SVG_CHEVRIGHT + '<span>View all ' + covered.toLocaleString() + ' loaded</span></button>' +
      '</div>';
      var go = dbody.querySelector(".cp-srch-rec-go");
      if (go) go.addEventListener("click", function () { cpGridShowState(state, "loading"); cpGridSortBy(state, state.sortK, state.sortDir, true); cpGridRenderResultsFillIn(state); });
      state.wrap.querySelector(".cp-srch-pg-cur").textContent = "—";
    }
    function cpGridRemoveGapBar(state) { var b = state.wrap && state.wrap.querySelector(".cp-srch-gapbar"); if (b) b.remove(); }
    function cpGridShowGapBar(state, baseCriteria, total, gap) {
      cpGridRemoveGapBar(state);
      var bar = document.createElement("div");
      bar.className = "cp-srch-gapbar";
      bar.innerHTML = '<span class="cp-srch-gapbar-txt">' + CP_SVG_FUNNEL + "<span>" + gap.toLocaleString() + " user" + (gap === 1 ? " wasn’t" : "s weren’t") + " found by name.</span></span>" +
        '<button type="button" class="cp-srch-gapbar-go">' + CP_SVG_SEARCH + "<span>Search by User ID</span></button>" +
        '<button type="button" class="cp-srch-gapbar-x" title="Dismiss">' + CP_SVG_X + "</button>";
      var results = state.wrap.querySelector(".cp-srch-results");
      if (results && results.parentNode) results.parentNode.insertBefore(bar, results);
      bar.querySelector(".cp-srch-gapbar-go").addEventListener("click", function () { cpGridDeepRemainder(state, baseCriteria, total); });
      bar.querySelector(".cp-srch-gapbar-x").addEventListener("click", function () { cpGridRemoveGapBar(state); });
    }
    // Cheap progress update during the sweep (counter + bar), no grid re-render. In "id" mode `loaded` is the
    // count of NEW rows found (the prior set is seeded as already-seen), shown as "prior + N found".
    function cpGridSweepProgress(state, loaded, total) {
      // id pass is GAP-anchored: `loaded` = NEW rows recovered so far, shown/filled against the gap we're hunting
      // (state._sweepGap) rather than the full total (which barely moves when prior ≈ total → looked frozen).
      var idMode = (state._sweepMode === "id"), gap = state._sweepGap;
      var card = state.wrap.querySelector(".cp-srch-sweep");
      if (card) {
        var cn = card.querySelector(".cp-srch-sweep-n");
        if (cn) {
          if (idMode) cn.innerHTML = loaded.toLocaleString() + ' <i>of ' + (gap != null ? gap.toLocaleString() : '?') + ' recovered</i>';
          else cn.textContent = loaded.toLocaleString() + (total ? " / " + total.toLocaleString() : "");
        }
        var fill = card.querySelector(".cp-srch-sweep-fill");
        if (fill) {
          if (idMode) { if (gap) fill.style.width = Math.min(100, Math.round(loaded / gap * 100)) + "%"; }
          else if (total) fill.style.width = Math.min(100, Math.round(loaded / total * 100)) + "%";
        }
      }
      if (state.countN) state.countN.textContent = idMode
        ? ("Recovering by ID… " + loaded.toLocaleString() + (gap != null ? " of " + gap.toLocaleString() : ""))
        : ("Loading… " + loaded.toLocaleString() + (total ? " / " + total.toLocaleString() : ""));
    }
    // Display a prefix char/string for the tracker + sub-line: spaces as ␣, HTML-escaped (specials incl. < > & ).
    function cpSweepDisp(s) { return cpEsc(String(s).replace(/ /g, "␣")); }
    // Update the alphabet tracker (current top-level char) + the live sub-prefix line for the bucket being searched.
    function cpGridSweepStatus(state, prefix) {
      var card = state.wrap.querySelector(".cp-srch-sweep");
      if (!card || !prefix) return;
      var seed = state._sweepSeed || "";
      var rel = (seed && prefix.indexOf(seed) === 0) ? prefix.slice(seed.length) : prefix;   // scoped: track by the char AFTER the seed (Mk → k)
      var top = rel.charAt(0), idx = CP_SWEEP_FULL_NOSP.indexOf(top);   // tracker is the no-space set; the top-level char is never a space
      var track = card.querySelector(".cp-srch-sweep-track");
      if (track) [].forEach.call(track.children, function (ch, i) { ch.classList.toggle("done", i < idx); ch.classList.toggle("cur", i === idx); });
      var group = seed ? cpSweepDisp(seed) : cpSweepDisp(top);   // the "M ›" / "m ›" anchor before the live sub-prefix
      var sub = card.querySelector(".cp-srch-sweep-sub");
      if (sub) sub.innerHTML = (prefix.length > 1)
        ? 'Scanning <span class="cp-srch-sweep-pp">' + group + '</span> › <span class="cp-srch-sweep-pill">' + cpSweepDisp(prefix) + '</span>'
        : 'Scanning <span class="cp-srch-sweep-pill">' + cpSweepDisp(prefix) + '</span>';
    }

    function cpGridRenderHead(state) {
      var head = state.wrap.querySelector(".cp-srch-dhead");
      head.style.gridTemplateColumns = cpGridTemplate(state.cols);
      head.innerHTML = state.cols.map(function (c) {
        var arrow = (c.idx === state.sortK)
          ? '<span class="cp-srch-arr">' + (state.sortDir > 0 ? CP_SVG_ARRUP : CP_SVG_ARRDOWN) + '</span>' : "";
        return '<div class="cp-srch-th' + (c.align === "center" ? " cen" : (c.num ? " num" : "")) + '" data-k="' + c.idx + '">' +
          cpEsc(c.label) + arrow + '</div>';
      }).join("");
      [].forEach.call(head.querySelectorAll(".cp-srch-th"), function (th) {
        th.addEventListener("click", function () {
          cpGridStopRiffle(state);   // cancel any in-flight decel scroll before re-sorting
          var k = +th.getAttribute("data-k");
          if (k === state.sortK) state.sortDir = -state.sortDir; else { state.sortK = k; state.sortDir = 1; }
          cpGridSortBy(state, state.sortK, state.sortDir, false);
          state.page = 0;
          cpGridRenderHead(state);
          cpGridRenderStatic(state);   // sort/page changes don't re-cascade — the stagger is for fresh searches only
        });
      });
    }
    function cpGridTemplate(cols) {
      // Mirrors the mockup's proportional widths: id/name wider, a fixed last column for numbers.
      // SERVICE INSTANCES ONLY (detected by its distinctive "Service Type" column): rebalance the 7 columns so the
      // long User-ID emails get the room they need and the narrow ones don't hog width — fits without scroll. Pure
      // fr ratios (no hard mins) so it never overflows. Every OTHER grid falls through to the unchanged default.
      var isSI = cols.some(function (c) { return (c.label || "").toLowerCase() === "service type"; });
      return cols.map(function (c, i) {
        if (isSI) {
          var lbl = (c.label || "").toLowerCase();
          if (lbl === "extension") return "100px";
          if (lbl === "user id") return "2.2fr";       // longest content (name@phonenetwork.net)
          if (lbl === "service type") return "1.4fr";
          if (lbl === "group id") return "1.2fr";
          return "1fr";                                // Organization ID, Name, Phone Number
        }
        if (c.type === "check") return "minmax(140px, 0.9fr)";   // room for the "In trunk group" header; content is just a centred ✓ / –
        if (c.type === "numc") return "120px";                   // centred extension
        if (c.type === "phone") return "minmax(150px, 1.1fr)";   // wide enough for the full number — no "…" clip
        if (c.type === "numpill" || c.type === "num") return "120px";
        if (i <= 1) return "1.5fr";
        return "1.1fr";
      }).join(" ");
    }
    function cpGridSortBy(state, k, dir, initial) {
      // Resolve the column by its .idx (cell index), NOT array position — a grid may drop a column (Service
      // Instances hides User ID) so position ≠ idx. Fall back to the first visible column if k no longer maps
      // to one (e.g. the default sortK:0 pointed at a removed column).
      var col = null, ci;
      for (ci = 0; ci < state.cols.length; ci++) { if (state.cols[ci].idx === k) { col = state.cols[ci]; break; } }
      if (!col && state.cols.length) { col = state.cols[0]; k = col.idx; }
      if (!col) col = { num: false };
      state.cur.sort(function (a, b) {
        var x = a.cells[k] || "", y = b.cells[k] || "";
        if (col.num) return (parseFloat(x.replace(/[^0-9.\-]/g, "")) - parseFloat(y.replace(/[^0-9.\-]/g, ""))) * dir;
        return String(x).localeCompare(String(y)) * dir;
      });
      state.sortK = k; state.sortDir = dir;
    }
    function cpGridTotalPages(state) { return Math.max(1, Math.ceil(state.cur.length / state.perPage)); }
    function cpGridCellHTML(state, row, c) {
      var v = row.cells[c.idx] == null ? "" : row.cells[c.idx];
      if (c.type === "id") return '<div class="cp-srch-td"><span class="cp-srch-gid">' + cpEsc(v) + "</span></div>";
      if (c.type === "muted") return '<div class="cp-srch-td cp-srch-mut">' + cpEsc(v) + "</div>";
      if (c.type === "badge") return '<div class="cp-srch-td"><span class="cp-srch-badge">' + (c.icon || "") + cpEsc(v) + "</span></div>";
      if (c.type === "numpill") { var hi = (c.deflt != null && v !== c.deflt) ? " hi" : ""; return '<div class="cp-srch-td ' + (c.align === "center" ? "cen" : "num") + '"><span class="cp-srch-lim' + hi + '">' + cpEsc(v) + "</span></div>"; }
      if (c.type === "num") return '<div class="cp-srch-td num">' + cpEsc(v) + "</div>";
      if (c.type === "numc") return '<div class="cp-srch-td cen">' + cpEsc(v) + "</div>";
      if (c.type === "phone") return '<div class="cp-srch-td cp-srch-phone">' + cpEsc(v) + "</div>";
      if (c.type === "check") return '<div class="cp-srch-td cen">' + (v ? '<span class="cp-srch-trunk-yes">' + CP_SVG_CHECK + '</span>' : '<span class="cp-srch-trunk-no">–</span>') + "</div>";
      return '<div class="cp-srch-td">' + cpEsc(v) + "</div>";
    }
    function cpGridRowHTML(state, row) {
      return '<div class="cp-srch-drow">' + state.cols.map(function (c) { return cpGridCellHTML(state, row, c); }).join("") + "</div>";
    }
    // Faint placeholder row (non-interactive) — fills the rest of a short page so the table reads as a full,
    // intentional list instead of leaving empty space below the real rows. Deterministic per-column widths.
    function cpGridGhostRowHTML(state, rowIdx) {
      var cells = state.cols.map(function (c, ci) {
        var num = (c.type === "num" || c.type === "numpill" || c.type === "numc");
        var cen = (c.align === "center");
        // Varied per (row, column) so the placeholders look random. Width is carried in data-w and applied via
        // CSSOM in cpGridApplyBarWidths — inline style="" ATTRIBUTES are blocked by the page CSP (style-src-attr).
        var w = num ? (24 + (rowIdx * 7) % 12) : (40 + (rowIdx * 17 + ci * 31) % 36);
        return '<div class="cp-srch-td' + (cen ? " cen" : (num ? " num" : "")) + '"><span class="cp-srch-gh" data-w="' + w + '"></span></div>';
      }).join("");
      return '<div class="cp-srch-ghostrow">' + cells + "</div>";
    }
    // Apply bar sizes via CSSOM. Inline style="" attributes set through innerHTML are CSP-blocked on this page
    // (only el.style.x = … applies), so ghost/skeleton bar widths are carried in data-* and set here.
    function cpGridApplyBarWidths(root) {
      [].forEach.call(root.querySelectorAll("[data-w]"), function (b) { b.style.width = b.getAttribute("data-w") + "%"; });
      [].forEach.call(root.querySelectorAll("[data-g]"), function (b) { b.style.flex = b.getAttribute("data-g") + " 0 0"; });
    }
    function cpGridPageHTML(state, p) {
      var slice = state.cur.slice(p * state.perPage, p * state.perPage + state.perPage);
      var html = slice.map(function (row) { return cpGridRowHTML(state, row); }).join("");
      for (var i = slice.length; i < state.perPage; i++) html += cpGridGhostRowHTML(state, i);   // i = absolute row idx → varied widths
      return html;
    }
    function cpGridSyncFoot(state) {
      var w = state.wrap, tp = cpGridTotalPages(state);
      w.querySelector(".cp-srch-pg-cur").textContent = (state.page + 1) + " / " + tp;
      var atFirst = state.page === 0, atLast = state.page >= tp - 1;
      w.querySelector(".cp-srch-first").classList.toggle("disabled", atFirst);
      w.querySelector(".cp-srch-prev").classList.toggle("disabled", atFirst);
      w.querySelector(".cp-srch-next").classList.toggle("disabled", atLast);
      w.querySelector(".cp-srch-last").classList.toggle("disabled", atLast);
    }
    function cpGridRenderStatic(state, animate) {
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      if (!state.cur.length) {
        dbody.innerHTML = '<div class="cp-srch-empty">No results match your search.</div>';
        cpGridSyncFoot(state); cpGridApplyRowTemplate(state); return;
      }
      var pg = document.createElement("div"); pg.className = "cp-srch-dpage";
      pg.innerHTML = cpGridPageHTML(state, state.page);
      dbody.innerHTML = ""; dbody.appendChild(pg);
      state.pageEl = pg;
      cpGridApplyRowTemplate(state);
      cpGridApplyBarWidths(pg);
      cpGridSyncFoot(state);
    }
    function cpGridApplyRowTemplate(state) {
      var tmpl = cpGridTemplate(state.cols);
      [].forEach.call(state.wrap.querySelectorAll(".cp-srch-drow, .cp-srch-ghostrow"), function (r) { r.style.gridTemplateColumns = tmpl; });
    }
    // Loading → results transition: FILL IN the loading boxes in place, one row at a time top-to-bottom, with the
    // real content DROPPING DOWN from above (like a waterfall) as the shimmer fades out. The real grid is overlaid
    // on the skeleton (both .dpage/.skwrap are absolute inset:0 → aligned), each real row animates in on its turn
    // while the matching skeleton row fades, then the skeleton is removed. WAAPI; skipped under reduced-motion.
    function cpGridRenderResultsFillIn(state) {
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      var skwrap = dbody.querySelector(".cp-srch-skwrap");
      var h = dbody.clientHeight || 400;
      state.perPage = Math.max(4, Math.floor(h / 46));
      state.page = 0;
      if (state.page > cpGridTotalPages(state) - 1) state.page = cpGridTotalPages(state) - 1;
      cpGridRenderHead(state);                       // swap the shimmer header for the real titles
      // The first-search skeleton uses GUESSED columns (state.skelCols from mount) which can differ from the
      // real result columns (e.g. the last numeric column's width) → its bubbles wouldn't sit under the real
      // cells. Re-render the skeleton to the RESULT columns so the overlay aligns. Skipped (no-op) when it
      // already matches, i.e. every search after the first.
      if (skwrap) {
        var resTmpl = cpGridTemplate(state.cols);
        var firstSk = skwrap.querySelector(".cp-srch-skg, .cp-srch-skrow");
        if (!firstSk || firstSk.classList.contains("cp-srch-skrow") || firstSk.children.length !== state.cols.length || firstSk.style.gridTemplateColumns !== resTmpl) {
          var nsk = Math.max(8, state.perPage), shtml = "", si, sci;
          for (si = 0; si < nsk; si++) {
            var scells = "";
            for (sci = 0; sci < state.cols.length; sci++) {
              var scol = state.cols[sci], snum = (scol.type === "num" || scol.type === "numpill");
              scells += '<div class="cp-srch-td' + (snum ? " num" : "") + '"><span class="cp-srch-sk" data-w="' + (snum ? (30 + (si * 7) % 16) : (48 + (si * 13 + sci * 29) % 42)) + '"></span></div>';
            }
            shtml += '<div class="cp-srch-ghostrow cp-srch-skg">' + scells + "</div>";
          }
          skwrap.innerHTML = shtml;
          [].forEach.call(skwrap.querySelectorAll(".cp-srch-skg"), function (r) { r.style.gridTemplateColumns = resTmpl; });
          cpGridApplyBarWidths(skwrap);
        }
      }
      var pg = document.createElement("div"); pg.className = "cp-srch-dpage";
      pg.innerHTML = cpGridPageHTML(state, state.page);
      dbody.appendChild(pg);                         // OVERLAY the real page on top of the skeleton
      state.pageEl = pg;
      cpGridApplyRowTemplate(state);
      cpGridApplyBarWidths(pg);
      cpGridSyncFoot(state);
      var head = state.wrap.querySelector(".cp-srch-dhead");
      var realRows = pg.querySelectorAll(".cp-srch-drow, .cp-srch-ghostrow");
      var skRows = skwrap ? skwrap.querySelectorAll(".cp-srch-skg, .cp-srch-skrow") : [];
      // During the overlap the skeleton row borders sit exactly on the real row borders (both rgba .05) and STACK
      // → the lines between rows look ~2× thicker. Drop the (fading) skeleton borders so only the real ones show.
      [].forEach.call(skRows, function (sk) { sk.style.borderBottomColor = "transparent"; });
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) { if (skwrap && skwrap.parentNode) skwrap.remove(); return; }
      var step = 85, dur = 300, ease = "cubic-bezier(.22,.7,.3,1)", drop = [{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }];
      [].forEach.call(head.children, function (th) { th.animate(drop, { duration: dur, easing: ease, fill: "backwards" }); });
      for (var i = 0; i < realRows.length; i++) {
        (function (i) {
          var rr = realRows[i], sk = skRows[i], delay = 80 + i * step;
          // Animate only the CELL CONTENT (the tds), not the row frame — the row stays put and aligned with the
          // skeleton bubble beneath, so the text drops INTO place instead of the whole box sliding (misaligned).
          [].forEach.call(rr.children, function (td) { td.animate(drop, { duration: dur, delay: delay, easing: ease, fill: "backwards" }); });
          // Pill fades out FAST (~90ms) the instant its text starts dropping in — a quick hand-off, no lingering crossfade.
          if (sk) sk.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, delay: delay, easing: "linear", fill: "forwards" });
        })(i);
      }
      setTimeout(function () { if (skwrap && skwrap.parentNode) skwrap.remove(); }, 80 + Math.max(0, realRows.length - 1) * step + dur + 80);
    }
    // Horizontal page-flip (WAAPI translateX), like turning a page. Robust against accumulation: under a
    // continuous scroll the next flip can fire before the previous out-animation's onfinish removes its layer,
    // so stale `.cp-srch-dpage` layers used to pile up and overlap (visible as superimposed rows). Now we track
    // the CURRENT layer (state.pageEl), kill any straggler that isn't it at the start of each flip, and run a
    // debounced backstop GC after flipping settles — so at most the outgoing + incoming layer ever coexist.
    function cpGridGoto(state, p, dir, dur) {
      var tp = cpGridTotalPages(state);
      p = Math.max(0, Math.min(tp - 1, p));
      if (p === state.page) return;
      dur = dur || 300;
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      // Kill any leftover layers from a prior interrupted flip (keep only the current one = oldEl).
      var oldEl = state.pageEl;
      [].slice.call(dbody.querySelectorAll(".cp-srch-dpage")).forEach(function (d) { if (d !== oldEl) d.remove(); });
      var np = document.createElement("div"); np.className = "cp-srch-dpage";
      np.innerHTML = cpGridPageHTML(state, p);
      var inFrom = dir > 0 ? "100%" : "-100%", outTo = dir > 0 ? "-100%" : "100%";
      np.style.transform = "translateX(" + inFrom + ")";
      dbody.appendChild(np);
      state.pageEl = np;
      state.page = p;
      cpGridApplyRowTemplate(state);
      cpGridApplyBarWidths(np);
      cpGridSyncFoot(state);
      var ease = "cubic-bezier(.45,0,.15,1)";
      np.animate([{ transform: "translateX(" + inFrom + ")" }, { transform: "translateX(0)" }], { duration: dur, easing: ease, fill: "forwards" });
      if (oldEl && oldEl !== np && oldEl.parentNode) {
        oldEl.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + outTo + ")" }], { duration: dur, easing: ease, fill: "forwards" })
          .onfinish = function () { if (oldEl.parentNode) oldEl.remove(); };
      }
      clearTimeout(state._flipGc);
      state._flipGc = setTimeout(function () {
        [].slice.call(dbody.querySelectorAll(".cp-srch-dpage")).forEach(function (d) { if (d !== state.pageEl) d.remove(); });
      }, dur + 90);
    }
    // First/Last and "go to page" navigation. SHORT hops (≤ CP_RIFFLE_MAX pages) flip page-by-page like a book.
    // BIG jumps do a single CONTINUOUS decelerating scroll (cpGridSpinTo): a strip of the intermediate pages slid
    // under one rAF-driven ease-out, so the real velocity ramps from a fast blur down to a slow crawl onto the
    // target — like a wheel of fortune coasting to a stop. Tunables below.
    var CP_RIFFLE_MAX = 8;          // ≤ this many pages away → snappy page-by-page; more → the decelerating flip flourish
    var CP_SPIN_FLIPS = 10;         // FIXED number of flips for a big jump (NOT proportional to distance)
    var CP_SPIN_DMIN = 50;          // first flip's slide duration (fast — snappy spin up front)
    var CP_SPIN_DMAX = 250;         // the spin flips decelerate DMIN→DMAX across the throwaway frames
    var CP_SPIN_DLAST = 330;        // the FINAL flip (landing on the target) — longer + eased for a slow glide-in settle
    var CP_SPIN_BLURMAX = 10;       // horizontal motion-blur sigma at the start; held high then ramped off only in the last flips
    function cpGridStopRiffle(state) {
      if (state._riffle) { clearTimeout(state._riffle); state._riffle = null; }
      if (state._pillRaf) { try { cancelAnimationFrame(state._pillRaf); } catch (e) {} state._pillRaf = 0; }
      var _db = state.wrap && state.wrap.querySelector(".cp-srch-dbody"); if (_db) _db.style.filter = "";   // clear any motion-blur left mid-flourish
      // a big-jump flourish commits its destination up front (state.page = target), so just drop the in-flight
      // flourish layers and render the committed target cleanly (cpGridRenderStatic → cpGridSyncFoot snaps the pager).
      if (state._spinning) { state._spinning = false; cpGridRenderStatic(state); }
    }
    // Lazy-built SVG filter for DIRECTIONAL (horizontal-only) motion blur on the big-jump flourish — feGaussianBlur
    // with stdDeviation "X 0" smears along the scroll axis only (vertical edges stay crisp). Built once, reused.
    function cpEnsureMblur() {
      var fe = document.getElementById("cp-mblur-fe");
      if (fe) return fe;
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      var defs = document.createElementNS(NS, "defs"), filter = document.createElementNS(NS, "filter");
      filter.setAttribute("id", "cp-mblur");
      filter.setAttribute("x", "-30%"); filter.setAttribute("y", "0%"); filter.setAttribute("width", "160%"); filter.setAttribute("height", "100%");
      fe = document.createElementNS(NS, "feGaussianBlur");
      fe.setAttribute("id", "cp-mblur-fe"); fe.setAttribute("in", "SourceGraphic"); fe.setAttribute("stdDeviation", "0 0");
      filter.appendChild(fe); defs.appendChild(filter); svg.appendChild(defs);
      document.body.appendChild(svg);
      return fe;
    }
    function cpGridFlipThrough(state, target) {
      cpGridStopRiffle(state);
      var tp = cpGridTotalPages(state);
      target = Math.max(0, Math.min(tp - 1, target));
      if (target === state.page) return;
      var dir = target > state.page ? 1 : -1;
      var steps = Math.abs(target - state.page);
      if (steps > CP_RIFFLE_MAX) { cpGridSpinTo(state, target, steps); return; }
      // page-by-page book-flip for short hops (snappy, ~520ms whole run)
      var iv = Math.max(24, Math.min(64, Math.round(520 / steps))), stops = [], p;
      for (p = state.page + dir; (dir > 0) ? (p <= target) : (p >= target); p += dir) stops.push(p);
      var i = 0;
      (function step() {
        if (!document.contains(state.wrap) || i >= stops.length) { state._riffle = null; return; }
        var next = Math.max(0, Math.min(cpGridTotalPages(state) - 1, stops[i])); i++;
        cpGridGoto(state, next, next >= state.page ? 1 : -1, 150);
        state._riffle = setTimeout(step, iv);
      })();
    }
    // Big-jump flourish: a FIXED number of horizontal page-flips that DECELERATE (each slide slower than the last),
    // flipping past throwaway RANDOM preloaded pages (pure motion — we already have every page) and ALWAYS landing
    // the final flip on the real target. The destination is committed up front (state.page = target, pager shows it)
    // so the count doesn't tick through every page and the state stays consistent if interrupted. Each flip ends
    // fully aligned (no fractional dwell → no column shear), and the last frame IS the target → no settle swap.
    function cpGridSpinTo(state, target, steps) {
      var dbody = state.wrap.querySelector(".cp-srch-dbody"), total = cpGridTotalPages(state);
      var feBlur = cpEnsureMblur(), blurUrl = 'url("' + location.href.split("#")[0] + '#cp-mblur")';   // absolute ref dodges the <base href> + url(#id) bug
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !dbody) { state.page = target; cpGridRenderStatic(state); cpGridSyncFoot(state); return; }
      var from = state.page, dir = target > state.page ? 1 : -1, N = Math.max(2, CP_SPIN_FLIPS), i;
      var frames = [], rndMax = Math.max(1, total - 1);      // EXCLUDE the last page from random picks — it's short / ghost-padded, so it flashes empty space mid-flourish
      for (i = 0; i < N - 1; i++) frames.push(Math.floor(Math.random() * rndMax));
      frames.push(target);
      var durs = [], totalDur = 0, dd;                       // slide durations grow fast → slow; the FINAL flip is a longer slow glide
      for (i = 0; i < N; i++) { dd = (i === N - 1) ? CP_SPIN_DLAST : Math.round(CP_SPIN_DMIN + (CP_SPIN_DMAX - CP_SPIN_DMIN) * Math.pow(i / (N - 1), 1.8)); durs.push(dd); totalDur += dd; }
      state.page = target; state._spinning = true;           // commit destination up front (state stays consistent if interrupted)
      // Simulated page counter: ease the number from the start page toward the target over the flourish (fast →
      // slow), instead of instantly snapping to the destination.
      var pill = state.wrap.querySelector(".cp-srch-pg-cur"), pt0 = null;
      function pillTick(now) {
        if (!state._spinning) { state._pillRaf = 0; return; }
        if (pt0 === null) pt0 = now;
        var p = Math.min(1, (now - pt0) / totalDur), e = 1 - Math.pow(1 - p, 2.2);
        if (pill) pill.textContent = (Math.round(from + (target - from) * e) + 1) + " / " + total;
        state._pillRaf = (p < 1) ? requestAnimationFrame(pillTick) : 0;
      }
      state._pillRaf = requestAnimationFrame(pillTick);
      var inFrom = dir > 0 ? "100%" : "-100%", outTo = dir > 0 ? "-100%" : "100%", idx = 0;
      (function flip() {
        if (!state._spinning || !document.contains(state.wrap)) return;
        var fi = idx, pg = frames[fi], d = durs[fi], last = (fi === N - 1); idx++;
        // LINEAR per flip so the travel SPEED itself ramps down (width/duration): early flips genuinely whip across,
        // late flips visibly crawl — a continuous wheel-style deceleration, not a per-flip snap-and-hold. The final
        // landing uses a gentle decelerate curve (starts near the flourish's slowed speed, eases to a soft stop) so
        // the target glides in slowly instead of speeding up and snapping.
        var ease = last ? "cubic-bezier(.25,.45,.4,1)" : "linear";
        // Directional (horizontal) motion blur ramped by flip INDEX (not speed) so it stays strong through the
        // spin and only ramps off over the last couple of flips before the crisp landing (last flip = 0) — instead
        // of thinning out early as the flips slow.
        var blurAmt = last ? 0 : Math.round(CP_SPIN_BLURMAX * (1 - Math.pow(fi / (N - 1), 2.5)));
        feBlur.setAttribute("stdDeviation", blurAmt + " 0");
        dbody.style.filter = blurAmt ? blurUrl : "";
        var np = document.createElement("div"); np.className = "cp-srch-dpage";
        np.innerHTML = cpGridPageHTML(state, pg);
        dbody.appendChild(np);
        cpGridApplyRowTemplate(state); cpGridApplyBarWidths(np);
        var prev = state.pageEl; state.pageEl = np;
        np.animate([{ transform: "translateX(" + inFrom + ")" }, { transform: "translateX(0)" }], { duration: d, easing: ease, fill: "forwards" });
        if (prev && prev.parentNode) prev.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + outTo + ")" }], { duration: d, easing: ease, fill: "forwards" }).onfinish = function () { if (prev.parentNode) prev.remove(); };
        if (last) state._riffle = setTimeout(function () { if (state._spinning && document.contains(state.wrap)) { state._spinning = false; cpGridRenderStatic(state); cpGridSyncFoot(state); } }, d + 20);
        else state._riffle = setTimeout(flip, d);
      })();
    }
    // perPage from the body height (fit-to-screen — the body is the only flexing region).
    function cpGridRecompute(state, force) {
      var dbody = state.wrap.querySelector(".cp-srch-dbody");
      var h = dbody.clientHeight || 400;
      var pp = Math.max(4, Math.floor(h / 46));
      // perPage targets ~46px rows; the rows themselves are flex:1 and short pages are padded to perPage with
      // ghost rows, so every row divides the body exactly (same size, no leftover strip at the bottom).
      if (pp !== state.perPage || force) {
        state.perPage = pp;
        if (state.page > cpGridTotalPages(state) - 1) state.page = cpGridTotalPages(state) - 1;
        // Only repaint the grid when the GRID (a .cp-srch-dpage) is what's actually showing. A deferred recompute
        // (cpGridRenderFilters' mount rAF, or a resize) must never clobber a STATE CARD with the grid render path.
        // The `state.cur.length` guard alone caught the empty states (initial/loading/no-match — landing on a
        // misleading "No results match your search." instead of "Search to see <entity>"), but the terminal
        // RECOVERED and "no matches by User ID" cards sit on a FULL state.cur, so a stray recompute could paint the
        // grid over them (observed intermittently). Requiring a live .cp-srch-dpage covers both.
        if (state.cur.length && state.wrap.querySelector(".cp-srch-dbody > .cp-srch-dpage")) cpGridRenderStatic(state, force);
      }
    }
    function cpGridWireStaticHandlers(state) {
      var w = state.wrap;
      w.querySelector(".cp-srch-first").addEventListener("click", function () { cpGridFlipThrough(state, 0); });
      w.querySelector(".cp-srch-prev").addEventListener("click", function () { cpGridStopRiffle(state); cpGridGoto(state, state.page - 1, -1); });
      w.querySelector(".cp-srch-next").addEventListener("click", function () { cpGridStopRiffle(state); cpGridGoto(state, state.page + 1, 1); });
      w.querySelector(".cp-srch-last").addEventListener("click", function () { cpGridFlipThrough(state, cpGridTotalPages(state) - 1); });
      // Go to page: type a 1-based page → jump there (clamped 1..M), via the capped riffle. Enter or the Go button.
      var gotoInput = w.querySelector(".cp-srch-goto-input");
      var gotoBtn = w.querySelector(".cp-srch-goto-go");
      function cpGridDoGoto() {
        if (!gotoInput) return;
        var n = parseInt(gotoInput.value, 10);
        gotoInput.value = "";
        if (isNaN(n)) return;
        var target = Math.max(0, Math.min(cpGridTotalPages(state) - 1, n - 1));
        if (target !== state.page) cpGridFlipThrough(state, target);
      }
      if (gotoBtn) gotoBtn.addEventListener("click", cpGridDoGoto);
      if (gotoInput) gotoInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); cpGridDoGoto(); } });
      // Scroll-to-paginate (wheel flips pages; 60px threshold + 300ms cooldown; pager remains a fallback).
      w.querySelector(".cp-srch-dtable").addEventListener("wheel", function (e) {
        e.preventDefault();
        if (state._spinning) cpGridStopRiffle(state);   // a wheel tick during a big-jump flourish cancels it
        if (state.cooling) return;
        state.accum += e.deltaY;
        if (Math.abs(state.accum) > 60) {
          var dir = state.accum > 0 ? 1 : -1; state.accum = 0;
          var t = state.page + dir;
          if (t < 0 || t > cpGridTotalPages(state) - 1) return;
          cpGridGoto(state, t, dir);
          state.cooling = true; setTimeout(function () { state.cooling = false; }, 300);
        }
      }, { passive: false });
      // Row click → drill into the entity (reuse the legacy redirectPost target captured per row).
      w.querySelector(".cp-srch-dbody").addEventListener("click", function (e) {
        var rowEl = e.target.closest && e.target.closest(".cp-srch-drow");
        if (!rowEl) return;
        var idx = [].indexOf.call(rowEl.parentNode.children, rowEl) + state.page * state.perPage;
        var row = state.cur[idx];
        if (row && row.drill && typeof redirectPost === "function") redirectPost(row.drill.url, row.drill.params);
      });
      // The +/− (Add/remove filter) and Search controls live INSIDE the criterion rows now (right of each row),
      // so they're wired per-render in cpGridRenderFilters — not here.
      window.addEventListener("resize", function () { if (document.contains(state.wrap)) cpGridRecompute(state); });
    }
    function cpGridRenderFilters(state, n) {
      state.criteriaCount = n;
      var frows = state.wrap.querySelector(".cp-srch-frows");
      var fieldSel = state.fieldOpts.map(function (o, i) { return '<option value="' + cpEsc(o.value) + '"' + (i === 0 ? " selected" : "") + ">" + cpEsc(o.label) + "</option>"; }).join("");
      var opSel = state.opOpts.map(function (o, i) { return '<option value="' + cpEsc(o.value) + '"' + (i === 0 ? " selected" : "") + ">" + cpEsc(o.label) + "</option>"; }).join("");
      var html = "";
      for (var i = 0; i < n; i++) {
        // Row action slot: the FIRST row carries the compact "+" box + Search button (the + adds a criterion
        // row, like the legacy page's inline +); every added row carries a "−" box. The slot is a fixed width
        // so Field/Match/value stay aligned across rows and the "−" sits directly under the "+".
        var act = (i === 0)
          ? '<button type="button" class="cp-srch-minib cp-srch-addb" title="Add filter">' + CP_SVG_PLUS + '</button>' +
            '<button type="button" class="cp-srch-btn cp-srch-go">' + CP_SVG_SEARCH + '<span>Search</span></button>'
          : '<button type="button" class="cp-srch-minib cp-srch-rm" title="Remove filter">' + CP_SVG_MINUS + '</button>';
        // Order: Field, Match, then VALUE (cp-srch-vslot — swapped in place for text / department dropdown /
        // Yes-No toggle by cpGridRenderRowValue), then the row actions. Mirrors the legacy page's layout.
        html += '<div class="cp-srch-frow">' +
          '<div class="cp-srch-sel cp-srch-dd"><span class="cp-srch-lab">Field</span><span class="cp-srch-ddval"></span>' + CP_SVG_CHEVDOWN + '<select class="cp-srch-field">' + fieldSel + '</select></div>' +
          '<div class="cp-srch-sel cp-srch-dd"><span class="cp-srch-lab">Match</span><span class="cp-srch-ddval"></span>' + CP_SVG_CHEVDOWN + '<select class="cp-srch-op">' + opSel + '</select></div>' +
          '<div class="cp-srch-search cp-srch-vslot">' + CP_SVG_SEARCH + '<input type="text" placeholder="Enter a value…"></div>' +
          '<div class="cp-srch-rowact">' + act + '</div>' +
        '</div>';
      }
      frows.innerHTML = html;
      // "+" box → add a criterion row (cap 5; dim at the cap).
      var addb = frows.querySelector(".cp-srch-addb");
      if (addb) {
        addb.classList.toggle("dim", n >= 5);
        addb.addEventListener("click", function () { if (state.criteriaCount < 5) cpGridRenderFilters(state, state.criteriaCount + 1); });
      }
      // "−" boxes → remove a criterion row.
      [].forEach.call(frows.querySelectorAll(".cp-srch-rm"), function (b) {
        b.addEventListener("click", function () { if (state.criteriaCount > 1) cpGridRenderFilters(state, state.criteriaCount - 1); });
      });
      // Search → run the preload.
      var go = frows.querySelector(".cp-srch-go");
      if (go) go.addEventListener("click", function () { cpGridRunSearch(state); });
      // Enter in a value field runs the search (matches the native site).
      [].forEach.call(frows.querySelectorAll(".cp-srch-search input"), function (inp) {
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); cpGridRunSearch(state); } });
      });
      // Custom Field/Match dropdowns (replace the native selects).
      cpGridWireDropdowns(frows);
      // When a row's FIELD changes, mirror the legacy page: swap the value box to/from a searchable dropdown
      // (Department → the group's departments) and refresh its Match operators. (cpGridOpenDDFor fires `change`
      // on the hidden .cp-srch-field select when a Field option is picked.)
      [].forEach.call(frows.querySelectorAll(".cp-srch-frow"), function (fr) {
        var fsel = fr.querySelector(".cp-srch-field");
        if (fsel) fsel.addEventListener("change", function () { cpGridApplyFieldMeta(state, fr); });
      });
      if (document.contains(state.wrap)) requestAnimationFrame(function () { cpGridRecompute(state); });
    }
    // Custom dropdown for the Field/Match selects (native <select> kept hidden + synced so cpGridRunSearch reads
    // .value; CSSOM for the fixed-position popup — inline style attrs are CSP-blocked, see
    // [[gotcha-csp-inline-style-attr-blocked]]). Style 1 (user-picked): hover rows tint lavender, selected = lavender + check.
    var cpGridDD = null, cpGridDDInit = false;
    // Per-field criteria metadata, sourced by driving the hidden legacy search form (see cpResolveFieldMeta).
    // Keyed by findKey value; RESET per grid build (cpBuildSearchGrid) because the department list is per-group.
    var cpFieldMetaCache = {};
    function cpGridWireOneDD(dd) {
      if (dd._cpWired) return; dd._cpWired = true;   // guard so re-wiring a row (dynamic value dd) doesn't double-bind Field/Match
      var sel = dd.querySelector("select"), valEl = dd.querySelector(".cp-srch-ddval");
      if (sel && valEl) valEl.textContent = (sel.options[sel.selectedIndex] || {}).text || "";
      dd.addEventListener("mousedown", function (e) {
        e.preventDefault();
        if (cpGridDD && cpGridDD.dd === dd) { cpGridCloseDD(); return; }   // toggle
        cpGridOpenDDFor(dd);
      });
    }
    function cpGridWireDropdowns(scope) {
      [].forEach.call(scope.querySelectorAll(".cp-srch-dd"), cpGridWireOneDD);
      if (!cpGridDDInit) {
        cpGridDDInit = true;
        document.addEventListener("mousedown", function (e) {
          if (cpGridDD && !cpGridDD.dd.contains(e.target) && !cpGridDD.menu.contains(e.target)) cpGridCloseDD();
        }, true);
        // Close on PAGE scroll (the popup is position:fixed), but NOT when the user scrolls the menu's OWN list —
        // the department picker has 100s of rows, so an inner scroll must not slam the menu shut.
        window.addEventListener("scroll", function (e) {
          if (cpGridDD && (e.target === cpGridDD.menu || (cpGridDD.menu.contains && cpGridDD.menu.contains(e.target)))) return;
          cpGridCloseDD();
        }, true);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") cpGridCloseDD(); });
      }
    }
    function cpGridOpenDDFor(dd) {
      cpGridCloseDD();
      var sel = dd.querySelector("select"), valEl = dd.querySelector(".cp-srch-ddval");
      // Searchable when flagged (the Department/value dropdown) or simply long — a filter box pins to the top.
      var searchable = dd.classList.contains("cp-srch-searchable") || sel.options.length > 12;
      var menu = document.createElement("div");
      menu.className = "cp-srch-ddmenu" + (searchable ? " cp-srch-ddmenu-s" : "");
      var optsHtml = [].map.call(sel.options, function (o, i) {
        var s = i === sel.selectedIndex;
        return '<div class="cp-srch-ddopt' + (s ? " sel" : "") + '" data-i="' + i + '"><span>' + cpEsc(o.text) + "</span>" + (s ? CP_SVG_CHECK : "") + "</div>";
      }).join("");
      menu.innerHTML = (searchable ? '<div class="cp-srch-ddsearch">' + CP_SVG_SEARCH + '<input type="text" placeholder="Filter…" autocomplete="off"></div>' : "") +
        '<div class="cp-srch-ddlist">' + optsHtml + "</div>";
      document.body.appendChild(menu);
      var r = dd.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.top = (r.bottom + 6) + "px";
      menu.style.left = r.left + "px";
      menu.style.minWidth = r.width + "px";
      // measure-and-subtract the scrollbar-gutter fixed-popup drift (see gotcha-scrollbar-gutter-fixed-drift).
      var mr = menu.getBoundingClientRect(), dx = mr.left - r.left, dy = mr.top - (r.bottom + 6);
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) { menu.style.left = (r.left - dx) + "px"; menu.style.top = (r.bottom + 6 - dy) + "px"; }
      dd.classList.add("open");
      cpGridDD = { dd: dd, menu: menu };
      function selectIndex(i) {
        if (i == null || i < 0) return;
        sel.selectedIndex = i;
        valEl.textContent = (sel.options[i] || {}).text || "";
        try { sel.dispatchEvent(new Event("change", { bubbles: true })); } catch (e2) {}
        cpGridCloseDD();
      }
      menu.addEventListener("mousedown", function (e) {
        var opt = e.target.closest && e.target.closest(".cp-srch-ddopt");
        if (!opt) return;
        e.preventDefault();
        selectIndex(+opt.getAttribute("data-i"));
      });
      if (searchable) {
        var sin = menu.querySelector(".cp-srch-ddsearch input");
        var listEl = menu.querySelector(".cp-srch-ddlist");
        // KEYBOARD NAV: arrows move the highlighted (.active) option among the VISIBLE rows, Enter picks it.
        function visOpts() { return [].filter.call(listEl.querySelectorAll(".cp-srch-ddopt"), function (o) { return o.style.display !== "none"; }); }
        function setActive(idx) {
          var os = visOpts();
          [].forEach.call(listEl.querySelectorAll(".cp-srch-ddopt.active"), function (o) { o.classList.remove("active"); });
          if (!os.length) return -1;
          if (idx < 0) idx = 0; else if (idx > os.length - 1) idx = os.length - 1;
          os[idx].classList.add("active");
          if (os[idx].scrollIntoView) os[idx].scrollIntoView({ block: "nearest" });
          return idx;
        }
        function activeIdx() { var os = visOpts(); for (var i = 0; i < os.length; i++) if (os[i].classList.contains("active")) return i; return -1; }
        sin.addEventListener("input", function () {
          var q = sin.value.toLowerCase(), any = false;
          [].forEach.call(listEl.querySelectorAll(".cp-srch-ddopt"), function (o) {
            var m = o.textContent.toLowerCase().indexOf(q) !== -1;
            o.style.display = m ? "" : "none"; if (m) any = true;
          });
          var emp = listEl.querySelector(".cp-srch-ddempty");
          if (!any) { if (!emp) { emp = document.createElement("div"); emp.className = "cp-srch-ddempty"; emp.textContent = "No matches"; listEl.appendChild(emp); } emp.style.display = ""; }
          else if (emp) { emp.style.display = "none"; }
          setActive(0);   // highlight the top match so Enter picks it
        });
        sin.addEventListener("keydown", function (e) {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIdx() + 1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); var a = activeIdx(); setActive(a < 0 ? 0 : a - 1); }
          else if (e.key === "Enter") { e.preventDefault(); var os = visOpts(), a = activeIdx(); var pick = os[a < 0 ? 0 : a]; if (pick) selectIndex(+pick.getAttribute("data-i")); }
          else if (e.key === "Escape") { e.preventDefault(); cpGridCloseDD(); }
        });
        setTimeout(function () { try { sin.focus(); } catch (e2) {} setActive(0); }, 0);
      }
      menu.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 130, easing: "ease-out" });
    }
    function cpGridCloseDD() {
      if (!cpGridDD) return;
      if (cpGridDD.menu.parentNode) cpGridDD.menu.remove();
      cpGridDD.dd.classList.remove("open");
      cpGridDD = null;
    }

    // Resolve a criteria FIELD's metadata by briefly driving the hidden legacy search form: set #findKey0 to the
    // field and fire `change`, then read what the page rebuilds. BroadWorks swaps findValue0 between a text input
    // and a <select> (e.g. Department → the group's 171 departments, In Trunk Group → the trunk groups). We MIRROR
    // that: text field → our text box; select field → our searchable value dropdown (Option C). The option VALUE
    // is a composite key (not the label), so we post .value. These enumerated "Exact*" fields are equality-only —
    // the legacy narrows findOp0 to EQUAL_TO (it does so ASYNC, so we don't read it; we set EQUAL_TO directly,
    // which is what the validated department search posts). Text fields keep the default operators (caller
    // falls back to state.opOpts). Restores #findKey0 after reading. Cached per build (per group).
    function cpResolveFieldMeta(fieldValue) {
      if (cpFieldMetaCache[fieldValue]) return cpFieldMetaCache[fieldValue];
      var meta = { ops: null, valueType: "text", options: [] };
      try {
        var lk = document.getElementById("findKey0");
        if (lk) {
          var prev = lk.value;
          lk.value = fieldValue;
          try { lk.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
          var lv = document.getElementsByName("findValue0")[0];
          if (lv && lv.tagName === "SELECT") {
            meta.options = [].map.call(lv.options, function (o) { return { value: o.value, label: (o.textContent || "").trim() }; });
            // A 2-option true/false select (In Trunk Group → Yes/No) renders as a segmented toggle; any other
            // select (Department → 171 options) renders as the searchable dropdown.
            var vals = meta.options.map(function (o) { return String(o.value).toLowerCase(); });
            meta.valueType = (meta.options.length === 2 && vals.indexOf("true") !== -1 && vals.indexOf("false") !== -1) ? "toggle" : "select";
            meta.ops = [{ value: "EQUAL_TO", label: "Equal To" }];
          }
          if (prev !== fieldValue) { lk.value = prev; try { lk.dispatchEvent(new Event("change", { bubbles: true })); } catch (e2) {} }
        }
      } catch (e) { console.warn("[pjax] field meta resolve", e); }
      cpFieldMetaCache[fieldValue] = meta;
      return meta;
    }
    // Rebuild a row's Match (op) dropdown options to mirror the field's legal operators.
    function cpGridSetRowOps(fr, ops) {
      if (!ops || !ops.length) return;
      var opSel = fr.querySelector(".cp-srch-op");
      if (!opSel) return;
      opSel.innerHTML = ops.map(function (o, i) { return '<option value="' + cpEsc(o.value) + '"' + (i === 0 ? " selected" : "") + ">" + cpEsc(o.label) + "</option>"; }).join("");
      opSel.selectedIndex = 0;
      var valEl = opSel.closest(".cp-srch-dd") && opSel.closest(".cp-srch-dd").querySelector(".cp-srch-ddval");
      if (valEl) valEl.textContent = (opSel.options[0] || {}).text || "";
    }
    // Swap a row's VALUE control (the .cp-srch-vslot cell) to mirror the field type: a searchable dropdown
    // (Department), a segmented Yes/No toggle (In Trunk Group — a true/false field), or the text box (default).
    function cpGridRenderRowValue(fr, meta) {
      var slot = fr.querySelector(".cp-srch-vslot") || fr.firstElementChild;
      var type = (meta && meta.options && meta.options.length && (meta.valueType === "select" || meta.valueType === "toggle")) ? meta.valueType : "text";
      if (type === "select") {
        if (slot.classList.contains("cp-srch-valdd")) return;   // already a value dropdown
        var optsHtml = meta.options.map(function (o, i) { return '<option value="' + cpEsc(o.value) + '"' + (i === 0 ? " selected" : "") + ">" + cpEsc(o.label) + "</option>"; }).join("");
        var dd = document.createElement("div");
        dd.className = "cp-srch-sel cp-srch-dd cp-srch-valdd cp-srch-searchable cp-srch-vslot";
        dd.innerHTML = '<span class="cp-srch-ddval"></span>' + CP_SVG_CHEVDOWN + "<select>" + optsHtml + "</select>";
        fr.replaceChild(dd, slot);
        cpGridWireOneDD(dd);
      } else if (type === "toggle") {
        if (slot.classList.contains("cp-srch-toggle")) return;   // already a toggle
        var tg = document.createElement("div");
        tg.className = "cp-srch-toggle cp-srch-vslot";
        tg.innerHTML = meta.options.map(function (o, i) {
          var yes = String(o.value).toLowerCase() === "true";   // true → Yes (✓, green) · false → No (✕, red)
          return '<button type="button" class="cp-srch-tgl ' + (yes ? "cp-srch-tgl-yes" : "cp-srch-tgl-no") + (i === 0 ? " on" : "") + '" data-v="' + cpEsc(o.value) + '">' + (yes ? CP_SVG_CHECK : CP_SVG_X) + "<span>" + cpEsc(o.label) + "</span></button>";
        }).join("");
        fr.replaceChild(tg, slot);
        [].forEach.call(tg.querySelectorAll(".cp-srch-tgl"), function (b) {
          b.addEventListener("click", function () { [].forEach.call(tg.querySelectorAll(".cp-srch-tgl"), function (x) { x.classList.toggle("on", x === b); }); });
        });
      } else {
        if (slot.classList.contains("cp-srch-search")) return;   // already a text box
        var box = document.createElement("div");
        box.className = "cp-srch-search cp-srch-vslot";
        box.innerHTML = CP_SVG_SEARCH + '<input type="text" placeholder="Enter a value…">';
        fr.replaceChild(box, slot);
        box.querySelector("input").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (cpGridState) cpGridRunSearch(cpGridState); } });
      }
    }
    // On a row's FIELD change, mirror the legacy page: update its Match operators + value control.
    function cpGridApplyFieldMeta(state, fr) {
      var fieldSel = fr.querySelector(".cp-srch-field");
      if (!fieldSel) return;
      var meta = cpResolveFieldMeta(fieldSel.value);
      cpGridSetRowOps(fr, (meta.ops && meta.ops.length) ? meta.ops : state.opOpts);
      cpGridRenderRowValue(fr, meta);
    }
    // Read a row's value generically: the Yes/No toggle's active value, or the dropdown's option VALUE, or the text.
    function cpGridRowValue(fr) {
      var tgl = fr.querySelector(".cp-srch-toggle .cp-srch-tgl.on");
      if (tgl) return tgl.getAttribute("data-v");
      var vsel = fr.querySelector(".cp-srch-valdd select");
      if (vsel) return vsel.value;
      var inp = fr.querySelector(".cp-srch-search input");
      return inp ? (inp.value || "").trim() : "";
    }
    function cpGridRunSearch(state) {
      var criteria = [];
      [].forEach.call(state.wrap.querySelectorAll(".cp-srch-frow"), function (fr) {
        criteria.push({
          key: fr.querySelector(".cp-srch-field").value,
          op: fr.querySelector(".cp-srch-op").value,
          value: cpGridRowValue(fr)
        });
      });
      cpGridLoad(state, criteria);
    }
    function cpEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    // Single-page sign-out. The footer Log out (confirmed in skin.js's modal,
    // which sets the cp-signing-out flag) calls redirectPost(logoutUrl, {}).
    // Rather than navigate to the raw /Logout/ landing and then bounce to
    // /Login/ (two documents → spinner restart + flash), we run the SAME logout
    // request as a background fetch while the "Signing out…" spinner stays on
    // THIS page, hold it for a minimum beat, then go once to the styled login.
    // Faithful to the real request: same url + params + the live formtokenserial
    // (what redirectPost itself would post). On fetch failure we fall back to the
    // real navigation logout (correctness over polish) — skin.js's cpLogoutToLogin
    // then carries /Logout/ → /Login/.
    function cpSignOutFetch(url, params) {
      var start = Date.now();
      var LOGIN = "/commpilot/Login/";
      function go() {
        var wait = Math.max(0, CP_LOGOUT_MIN_MS - (Date.now() - start));
        setTimeout(function () {
          var navd = false;
          function nav() { if (navd) return; navd = true; try { location.replace(LOGIN); } catch (e) { location.href = LOGIN; } }
          // Just before the swap, HIDE the base console (sidebar) + darken html/body.
          // THIS is the real flash fix: at the document-swap teardown the browser
          // drops the fixed overlay from the painted frame but still paints the base
          // console (sidebar) — so the base must be display:none, not merely covered
          // (proven: a pagehide trace showed the sidebar 0×0/display:none = no flash,
          // while opaque-overlay attempts still flashed). The console stays VISIBLE
          // (dimmed) through the hold for the popup look; we only hide it here.
          try {
            var de = document.documentElement, b = document.body;
            de.style.setProperty("background", "#1c1b19", "important");
            b.style.setProperty("background", "#1c1b19", "important");
            var kids = b.children;
            for (var i = 0; i < kids.length; i++) {
              var ch = kids[i];
              if (ch.classList && ch.classList.contains("cp-logout-overlay")) continue;
              var t = ch.tagName;
              if (t === "SCRIPT" || t === "STYLE" || t === "LINK") continue;
              ch.style.setProperty("display", "none", "important");
            }
          } catch (e) {}
          // Force a paint of the hidden state before navigating, so the HELD teardown
          // frame is base-hidden (a single rAF runs before paint; double = after one
          // paint). setTimeout is the fallback for throttled/background tabs.
          try { requestAnimationFrame(function () { requestAnimationFrame(nav); }); } catch (e) { nav(); }
          setTimeout(nav, 160);
        }, wait);
      }
      function fallback() { try { _orig.call(window, url, params); } catch (e) { go(); } }
      try {
        var body = new URLSearchParams();
        for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) body.append(k, params[k]);
        var tEl = document.getElementsByName("formtokenserial")[0];
        if (tEl && tEl.value) body.append("formtokenserial", tEl.value);
        console.log("[pjax] sign-out fetch", url);
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "same-origin"
        }).then(go, fallback);
      } catch (e) { fallback(); }
    }

    cpHook = function (url, params, _retry) {
      try {
        // Sign-out interception (must precede isPjaxUrl): when skin.js's logout
        // confirmation has armed cp-signing-out, this redirectPost IS the logout.
        var _so = 0; try { _so = parseInt(sessionStorage.getItem("cp-signing-out") || "0", 10); } catch (e) {}
        if (_so && (Date.now() - _so < 15000)) { cpSignOutFetch(url, params || {}); return; }
        if (isPjaxUrl(url)) {
          var mySeq = ++cpSeq;
          // A real navigation (drill-in, reload replay, sidebar click) supersedes any in-flight grid search OR
          // deep sweep — abort both so their background fetches stop rotating the single-use token and racing
          // with THIS POST.
          try { if (cpGridState && cpGridState._searchAbort) cpGridState._searchAbort.abort(); } catch (e) {}
          try { if (cpGridState && cpGridState._sweepAbort) cpGridState._sweepAbort.abort(); } catch (e) {}
          try { cpLastNav = { url: url, params: params || {} }; } catch (e) {}
          // Remember the SP entry (Modify nav) — recorded for reload/replay + future Group/User work.
          try { if (/\/ServiceProviders\/Modify\//.test(url)) cpSpEntry = { url: url, params: params || {} }; } catch (e) {}
          try { if (url.indexOf("/Common/page.jsp") === -1 && url.indexOf("/Common/sort.jsp") === -1) { var _nav = { url: url, params: params || {} }; sessionStorage.setItem("cp-last-nav", JSON.stringify(_nav)); window.postMessage({ __cpRecoverNav: _nav }, location.origin); } } catch (e) {}
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var firstTok = liveTokEl ? liveTokEl.value : null;
          var cpLoader = cpNeedsFrame(url, params) ? cpFollowFrame : cpFollow;
          console.log("[pjax]", cpLoader === cpFollowFrame ? "iframe-loading" : "fetching", url);
          cpLoader(url, params, firstTok, 0)
            .then(function (res) {
              if (mySeq !== cpSeq) {
                console.log("[pjax] superseded — dropping stale swap");
                return;
              }
              if (!res || res.auth === false || !res.doc || !res.doc.querySelector('td[width="82%"]')) {
                // The follow came back unusable — EITHER the login page (auth:false) OR a non-content/error doc.
                // A grid search rotating the single-use formtokenserial under us produces the SECOND case (no
                // AUTH-FAIL is logged), and that path used to fall straight through to the real navigation below.
                // In BOTH cases the live token has since been refreshed, so re-attempt ONCE with it before the
                // real navigation — which with a stale token dumps the user on the Login screen ("session
                // timeout"). This is the confirmed reload-bounce mechanism (no AUTH-FAIL → _orig fallback).
                if (!_retry) {
                  var freshTok = (document.getElementsByName("formtokenserial")[0] || {}).value;
                  if (freshTok && freshTok !== firstTok) {
                    console.warn("[pjax] follow unusable + token rotated under us — re-attempting nav with refreshed token");
                    cpHook(url, params, true);
                    return;
                  }
                }
                console.warn("[pjax] no content cell after follow — real navigation fallback");
                _orig.call(window, url, params);
                return;
              }
              var doc = res.doc;

              // Stash the FRESH current entity (user/group id) from the fetched doc so cpBuildConsole's
              // breadcrumb can append it — the live header keeps the previous entity across pjax navs, and the
              // swapped content cell has none. Empty string when the new level has no entity (reseller/SP/group)
              // → cpBuildConsole appends no id pill (and the stale header value is ignored).
              try { var _fe = doc.querySelector("span.headerAuthLevel"); cpCurEntity = _fe ? (_fe.textContent || "").replace(/^\s*:\s*/, "").trim() : ""; } catch (e) { cpCurEntity = ""; }

              // Token refresh from response
              var newTok = doc.getElementsByName("formtokenserial")[0];
              if (newTok) {
                var tokens = document.getElementsByName("formtokenserial");
                for (var i = 0; i < tokens.length; i++) tokens[i].value = newTok.value;
              }

              // Swap content cell
              var fetched = doc.querySelector('td[width="82%"]');
              var liveCell = document.querySelector('td[width="82%"]');
              if (!fetched || !liveCell) {
                console.warn("[pjax] content cell not found", !!fetched, !!liveCell);
                return;
              }
              liveCell.innerHTML = fetched.innerHTML;

              // Level change → swap the sidebar too. pjax normally KEEPS the sidebar and only syncs the
              // active highlight (reseller folders never change), but entering an SP/Group/User swaps the
              // whole folder set (reseller R-folders ⇄ Service-Provider S-folders, etc.). Swap when the
              // fetched folder signature differs; its wiring scripts are re-executed in the shim block
              // below (cpLiveNav) so the new folders' clicks navigate.
              var cpLiveNav = null;
              try {
                var fNav = doc.querySelector('form[name="leftNavForm"]');
                var liveNav = document.querySelector('form[name="leftNavForm"]');
                if (fNav && liveNav && cpSidebarSig(fNav) !== cpSidebarSig(liveNav)) {
                  // LEVEL CHANGE (e.g. group → SP via the breadcrumb): drop any aggregation state still in
                  // flight from the OLD level. Otherwise the new level's cpBuildConsole hits its
                  // `aggLevel && cpAggActive` dedup guard (cpAggActive lingering from the level we just left)
                  // and BAILS — so e.g. clicking the SP pill mid-group-build shows the SP's raw single-folder
                  // menu instead of the aggregated console until a later rebuild clears the flag.
                  cpAggEnd();
                  liveNav.innerHTML = fNav.innerHTML;
                  cpLiveNav = liveNav;
                }
              } catch (e) { console.warn("[pjax] sidebar swap", e); cpLiveNav = null; }

              // Update tab title from fetched page
              try { if (doc.title) document.title = doc.title; } catch (e) {}

              // Restore breadcrumb above swapped title — PILL TRAIL (cpBuildPillCrumb), matching the console
              // and the initial-load crumb. Source the trail texts from the fetched header links (deduped);
              // cpBuildPillCrumb wires the ancestors (cpCrumbNav). This replaces the old bare-<a> crumb that
              // made non-console pages revert to the legacy look after a pjax nav.
              try {
                var fCrumbLink = doc.querySelector('td.headerBar a.headerAuthLevelLink');
                var newTitle = liveCell.querySelector("td.screenName");
                if (fCrumbLink && newTitle) {
                  var fCell = fCrumbLink.closest("td");
                  var titleTable = newTitle.closest("table");
                  var ctLinks = Array.prototype.slice.call(fCell.querySelectorAll("a.headerAuthLevelLink"));
                  var ctrail = [];
                  ctLinks.forEach(function (a) { var t = (a.textContent || "").trim(); if (t && (!ctrail.length || ctrail[ctrail.length - 1] !== t)) ctrail.push(t); });
                  // Append the CURRENT PAGE as the trailing pill(s) so the trail names where you are:
                  //  • Entity (a user id in span.headerAuthLevel) → the id pill. On a user SUB-PAGE (a settings
                  //    page, no navMenuItem) the id becomes a clickable ANCESTOR and the page name is the
                  //    current pill: "… Group › <user-id> › Addresses". On the user home (a folder MENU) the id
                  //    is the current pill.
                  //  • A plain LIST page (no entity) → the screenName as the current pill ("… › Groups").
                  //  • A folder MENU (a level base/home — has navMenuItem) → no page pill: it becomes the
                  //    aggregated console, whose anchor ("Profile") isn't a page. (cpBuildConsole inherits this
                  //    crumb, so a stray name here would leak onto the console.)
                  var isMenu = !!doc.querySelector("a.navMenuItem");
                  var cEnt = doc.querySelector("span.headerAuthLevel");
                  var et = cEnt ? (cEnt.textContent || "").replace(/^\s*:\s*/, "").trim() : "";
                  if (et && ctrail[ctrail.length - 1] === et) et = "";   // dedupe vs last ancestor
                  var sn = "";
                  if (!isMenu && newTitle) {
                    sn = (newTitle.textContent || "").trim();
                    var ci = sn.indexOf(": "); if (ci > 0 && sn.slice(0, ci).indexOf(" ") === -1) sn = sn.slice(ci + 2).trim();  // strip a leading "<id>: " prefix
                  }
                  if (et) ctrail.push(et);                                   // entity id: ancestor if a page follows, else current
                  var isIdLast = !!et;
                  if (sn && ctrail[ctrail.length - 1] !== sn) { ctrail.push(sn); isIdLast = false; }   // page name = current pill
                  if (ctrail.length && titleTable && titleTable.parentNode) {
                    titleTable.parentNode.insertBefore(cpBuildPillCrumb(ctrail, isIdLast, true), titleTable);   // sub-page → mega menu on the current pill
                  }
                }
              } catch (e) {
                console.warn("[pjax] breadcrumb restore", e);
              }

              // Sync sidebar active highlight to fetched page
              try {
                var fOpen = doc.querySelector("a.leftnavfolderopen");
                var openText = fOpen ? fOpen.textContent.trim() : null;
                if (openText) {
                  // Only the real folder anchors — NOT the submenu sub-items, which are also
                  // <a> inside leftNavForm. Without :not(.cp-subitem) the sync slapped
                  // leftnavfolder/leftnavfolderopen onto every sub-item, restyling them as
                  // folders for a frame on each pjax nav (the sidebar "jump" on option click).
                  document.querySelectorAll('form[name="leftNavForm"] a:not(.cp-subitem)').forEach(function (la) {
                    var active = la.textContent.trim() === openText;
                    la.classList.toggle("leftnavfolderopen", active);
                    la.classList.toggle("leftnavfolder", !active);
                    var td = la.closest("td");
                    if (td) {
                      td.classList.toggle("leftnavfolderopen", active);
                      td.classList.toggle("leftnavfolder", !active);
                    }
                  });
                }
              } catch (e) {
                console.warn("[pjax] sidebar sync", e);
              }

              // Re-execute swapped scripts under nonce-CSP
              var origAdd = document.addEventListener;
              document.addEventListener = function (type, fn, opts) {
                if (type === "DOMContentLoaded" && typeof fn === "function") {
                  Promise.resolve().then(function () {
                    try {
                      fn.call(document, new Event("DOMContentLoaded"));
                    } catch (e) {
                      console.warn("[pjax] DCL err", e);
                    }
                  });
                  return;
                }
                return origAdd.call(this, type, fn, opts);
              };
              var origWinAdd = window.addEventListener;
              window.addEventListener = function (type, fn, opts) {
                if (type === "load" && typeof fn === "function") {
                  Promise.resolve().then(function () {
                    try { fn.call(window, new Event("load")); } catch (e) { console.warn("[pjax] load shim err", e); }
                  });
                  return;
                }
                return origWinAdd.call(this, type, fn, opts);
              };
              var n = reexecScripts(liveCell);
              if (cpLiveNav) reexecScripts(cpLiveNav);
              document.addEventListener = origAdd;
              window.addEventListener = origWinAdd;
              if (window.redirectPost !== cpHook) { _orig = window.redirectPost; window.redirectPost = cpHook; }
              console.log("[pjax] re-executed", n, "scripts");
              document.dispatchEvent(new CustomEvent("cp:reskin"));
              console.log("[pjax] reskin dispatched");
              var canonical = url;
              if ((url.indexOf("/Common/page.jsp") !== -1 || url.indexOf("/Common/sort.jsp") !== -1) && params && params.returnPage) {
                var rp = String(params.returnPage);
                canonical = rp.indexOf("/commpilot") === 0 ? rp : ("/commpilot" + (rp.charAt(0) === "/" ? rp : "/" + rp));
              }
              try {
                var cpState = { cpNav: { url: url, params: params || {} } };
                if (cpPopReplaying) { history.replaceState(cpState, "", canonical); cpPopReplaying = false; }
                else { history.pushState(cpState, "", canonical); }
              } catch (e) {}
            })
            .catch(function (e) {
              console.warn("[pjax] fetch FAILED", e);
            });

          return; // do NOT call _orig — no navigation for menu navs
        }
      } catch (e) {}
      return _orig.apply(this, arguments);
    };

    window.redirectPost = cpHook;

    document.addEventListener("submit", function (e) {
      try {
        var form = e.target;
        if (!form || form.tagName !== "FORM") return;
        if (!isPjaxUrl(form.action || "")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var params = {}, els = form.elements;
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (!el.name || el.name === "formtokenserial") continue;
          if (el.type === "submit" || el.type === "button") continue;
          if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
          params[el.name] = el.value;
        }
        if (e.submitter && e.submitter.name) params[e.submitter.name] = e.submitter.value;
        window.redirectPost(form.action, params);
      } catch (err) { console.warn("[pjax] submit intercept", err); }
    }, true);

    window.addEventListener("keydown", function (e) {
      var isF5 = e.key === "F5" || e.keyCode === 116;
      var isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R" || e.keyCode === 82);
      if (!isF5 && !isCtrlR) return;
      if (e.shiftKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // DEDUPE: pjax is injected into every frame (all_frames) AND key-repeat fires this handler several times in
      // a row → multiple concurrent replays that race on the single-use formtokenserial and log the user out
      // (esp. after a token-rotating broad search). sessionStorage is shared across frames, so only the FIRST
      // reload within the window actually replays; the rest are swallowed.
      try {
        var _rNow = Date.now(), _rLast = parseInt(sessionStorage.getItem("cp-reload-at") || "0", 10);
        if (_rNow - _rLast < 1500) return;
        sessionStorage.setItem("cp-reload-at", String(_rNow));
      } catch (eD) {}
      var _gs = cpGridState;
      // Abort any active grid search OR deep sweep FIRST so it stops launching token-rotating page.jsp hops.
      if (_gs && _gs._searchAbort) { try { _gs._searchAbort.abort(); } catch (e2) {} }
      if (_gs && _gs._sweepAbort) { try { _gs._sweepAbort.abort(); } catch (e2) {} }
      // THE FIX for the "rapid 2 broad searches + reload → logout" bug: when the search GRID is active we are on
      // a real, GET-loadable list URL (Reseller/Groups), so a NATIVE reload lands on the same authenticated page
      // with NO formtokenserial POST at all — completely sidestepping the single-use-token race that bounced the
      // user to Login. (The in-flight search fetches are cancelled by the unload.) The redirectPost-replay path
      // below is only needed for DEEP, POST-only pages whose address-bar URL would otherwise reload to the wrong
      // place; the grid is never one of those.
      if (_gs) {
        console.log("[pjax] reload intercepted → native reload (grid active, GET-safe)");
        try { location.reload(); } catch (e3) { try { location.href = location.href; } catch (e4) {} }
        return;
      }
      // Fall back to the persisted cp-last-nav (sessionStorage) before the reseller-home default: after a
      // reload-button recovery the page is fresh, so the in-memory cpLastNav is null even though we ARE deep
      // in an SP/group/user — without this, F5 right after the reload button jumps all the way to reseller.
      var nav = cpLastNav;
      if (!nav) { try { nav = JSON.parse(sessionStorage.getItem("cp-last-nav") || "null"); } catch (e) {} }
      if (!nav || !nav.url) nav = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
      console.log("[pjax] reload intercepted → replay", nav.url);
      // Even off the grid, a token-bearing POST may be mid-rotation (a console/aggregation fetch). DRAIN all
      // in-flight token-POSTs to 0 (max ~1.6s) before replaying, so the reload's POST can't race a fetch over the
      // single-use token. This counts an aborted-but-still-resolving prior search too — which the old
      // single-_searchPromise wait missed (abort stops the loop, not the in-flight fetch).
      var _navGo = function () { try { window.redirectPost(nav.url, nav.params || {}); } catch (err) { console.warn("[pjax] reload replay failed", err); } };
      var _t0 = Date.now();
      (function _drain() {
        if (cpInflightPosts <= 0 || Date.now() - _t0 > 1600) { _navGo(); return; }
        setTimeout(_drain, 40);
      })();
    }, true);

    window.addEventListener("popstate", function (e) {
      try {
        var nav = e.state && e.state.cpNav;
        if (!nav || !nav.url) return;
        cpPopReplaying = true;
        console.log("[pjax] popstate → replay", nav.url);
        window.redirectPost(nav.url, nav.params || {});
      } catch (err) { cpPopReplaying = false; console.warn("[pjax] popstate replay failed", err); }
    }, false);

    try {
      if (
        !onLogin &&
        sessionStorage.getItem("cp-pending-return") === "1"
      ) {
        sessionStorage.removeItem("cp-pending-return");
        var last = JSON.parse(sessionStorage.getItem("cp-last-nav") || "null");
        if (last && last.url) {
          console.log("[pjax] auto-return →", last.url, last.params);
          setTimeout(function () {
            try {
              window.redirectPost(last.url, last.params || {});
            } catch (e) {
              console.warn("[pjax] auto-return failed", e);
            }
          }, 0);
        }
      }
    } catch (e) {}

    // ---- Unified Console (Phase 1) ----------------------------------
    function cpReexecWiringScripts(container) {
      var origAdd = document.addEventListener;
      document.addEventListener = function (type, fn, opts) {
        if (type === "DOMContentLoaded" && typeof fn === "function") {
          Promise.resolve().then(function () { try { fn.call(document, new Event("DOMContentLoaded")); } catch (e) { console.warn("[pjax] console DCL shim err", e); } });
          return;
        }
        return origAdd.call(document, type, fn, opts);
      };
      var origWinAdd = window.addEventListener;
      window.addEventListener = function (type, fn, opts) {
        if (type === "load" && typeof fn === "function") {
          Promise.resolve().then(function () { try { fn.call(window, new Event("load")); } catch (e) { console.warn("[pjax] console load shim err", e); } });
          return;
        }
        return origWinAdd.call(window, type, fn, opts);
      };
      var nonce = LIVE_NONCE || (document.querySelector("script[nonce]") || {}).nonce || "";
      var scripts = container.querySelectorAll("script");
      for (var si = 0; si < scripts.length; si++) {
        var old = scripts[si];
        if (old.src) continue;
        var txt = (old.textContent || "").trim();
        if (!txt || !/getElementById\(['"](?:link_|anchor_)/.test(txt) || !/redirectPost/.test(txt)) continue;
        var s = document.createElement("script");
        if (nonce) s.setAttribute("nonce", nonce);
        s.textContent = txt;
        try { old.parentNode.replaceChild(s, old); } catch (e) {}
      }
      document.addEventListener = origAdd;
      window.addEventListener = origWinAdd;
      if (window.redirectPost !== cpHook) { _orig = window.redirectPost; window.redirectPost = cpHook; }
    }

    function cpEnqueueSection(fn) {
      if (cpSectionAborted) return;
      cpSectionQueue.push(fn);
      cpProcessSectionQueue();
    }
    function cpProcessSectionQueue() {
      if (cpSectionAborted) { cpSectionQueue = []; cpSectionRunning = false; return; }
      if (cpSectionRunning || cpSectionQueue.length === 0) return;
      cpSectionRunning = true;
      var next = cpSectionQueue.shift();
      try {
        var p = next();
        if (p && typeof p.then === "function") {
          p.then(function () { cpSectionRunning = false; cpProcessSectionQueue(); })
           .catch(function () { cpSectionRunning = false; cpProcessSectionQueue(); });
        } else {
          cpSectionRunning = false; cpProcessSectionQueue();
        }
      } catch (e) {
        cpSectionRunning = false; cpProcessSectionQueue();
      }
    }

    function cpFetchSection(folder, menuId) {
      return new Promise(function (resolve) {
        cpEnqueueSection(function () {
          if (cpSectionAborted) { resolve(null); return; }
          if (cpAggActive) {
            // SP level: load this folder via the bare sidebar-click params over cpFollowFrame.
            return cpAggNavigate(folder, menuId).then(function (html) { resolve(html); });
          }
          // RESELLER anchor: reuse the menu cpHook just fetched to navigate here (captured in
          // cpBuildConsole) instead of issuing an identical, redundant folder_contents on the rotating
          // token. One-shot — clear after use so it can never go stale or be reused by a later build.
          if (cpEntryFolder && cpEntryFolder === folder && cpEntryHtml != null) {
            var reuse = cpEntryHtml; cpEntryFolder = null; cpEntryHtml = null;
            resolve(reuse); return;
          }
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var token = liveTokEl ? liveTokEl.value : null;
          return cpFollow("/commpilot/Common/folder_contents.jsp", { folder: folder, menuId: menuId || "8" }, token, 0)
            .then(function (res) {
              if (cpSectionAborted || !res || res.auth === false || !res.doc) { resolve(null); return; }
              var newTok = res.doc.getElementsByName("formtokenserial")[0];
              if (newTok) {
                var tokens = document.getElementsByName("formtokenserial");
                for (var i = 0; i < tokens.length; i++) tokens[i].value = newTok.value;
              }
              var td = res.doc.querySelector('td[width="82%"]');
              resolve(td ? td.innerHTML : null);
            })
            .catch(function () { resolve(null); });
        });
      });
    }

    function cpSetSectionCount(bodyEl) {
      if (!bodyEl) return;
      var n = bodyEl.querySelectorAll('a[id^="link_"]').length || bodyEl.querySelectorAll('.cp-menu-card').length;
      var sec = bodyEl.closest('.cp-console-section');
      var chip = sec ? sec.querySelector('.cp-console-head .cp-console-count') : null;
      if (!chip) return;
      if (n > 0) { chip.textContent = String(n); chip.hidden = false; }
      else { chip.hidden = true; }
    }

    // Option `name` paths whose leaf pages are simple read-only label:value settings — summarize inline.
    var CP_LEAF_ALLOW = ["/Reseller/Profile/"];

    function cpFetchLeaf(path) {
      return new Promise(function (resolve) {
        cpEnqueueSection(function () {
          if (cpSectionAborted) { resolve(null); return; }
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var token = liveTokEl ? liveTokEl.value : null;
          return cpFollow(path, {}, token, 0)
            .then(function (res) {
              if (cpSectionAborted || !res || res.auth === false || !res.doc) { resolve(null); return; }
              var newTok = res.doc.getElementsByName("formtokenserial")[0];
              if (newTok) {
                var tokens = document.getElementsByName("formtokenserial");
                for (var i = 0; i < tokens.length; i++) tokens[i].value = newTok.value;
              }
              var cell = res.doc.querySelector('td[width="82%"]');
              if (!cell) { resolve(null); return; }
              // Verify leaf-like: not a list (no search/results table)
              if (cell.querySelector('#searchTable, #resultsTable, input[name="searchString"]')) { resolve(null); return; }
              var out = [];
              var trs = cell.querySelectorAll("tr");
              for (var j = 0; j < trs.length && out.length < 6; j++) {
                var tds = [];
                for (var k = 0; k < trs[j].children.length; k++) { if (trs[j].children[k].tagName === "TD") tds.push(trs[j].children[k]); }
                if (tds.length < 2) continue;
                var label = (tds[0].textContent || "").trim();
                if (!label || label.length > 40 || !/:\s*$/.test(label)) continue;  // label cells end with ":"
                var inp = tds[1].querySelector("input, select, textarea");
                var val = inp ? (inp.value || "") : (tds[1].textContent || "").trim();
                if (!val) continue;
                out.push({ label: label.replace(/:\s*$/, ""), value: val.slice(0, 80) });
              }
              resolve(out.length ? out : null);
            })
            .catch(function () { resolve(null); });
        });
      });
    }

    function cpSummarizeLeaves(bodyEl) {
      if (!bodyEl) return;
      CP_LEAF_ALLOW.forEach(function (target) {
        var anchor = bodyEl.querySelector('a[name="' + target + '"]');
        if (!anchor) return;
        var card = anchor.closest(".cp-menu-card") || anchor.parentNode;
        if (!card || card.querySelector(".cp-leaf-summary")) return;  // already summarized
        var box = document.createElement("div");
        box.className = "cp-leaf-summary";
        var loading = document.createElement("div");
        loading.className = "cp-leaf-loading";
        loading.textContent = "\u2026";
        box.appendChild(loading);
        card.appendChild(box);
        cpFetchLeaf("/commpilot" + target).then(function (rows) {
          if (cpSectionAborted || !document.querySelector(".cp-console") || !box.isConnected) { return; }
          if (!rows) { box.remove(); return; }
          box.innerHTML = "";
          rows.forEach(function (r) {
            var row = document.createElement("div"); row.className = "cp-leaf-row";
            var k = document.createElement("span"); k.className = "cp-leaf-key"; k.textContent = r.label;
            var v = document.createElement("span"); v.className = "cp-leaf-val"; v.textContent = r.value;
            row.appendChild(k); row.appendChild(v); box.appendChild(row);
          });
          // This summary just grew (… → real rows). If it sits in a section ABOVE a jump anchor, that
          // growth shoved the anchor down — re-pin the anchor flush. Gated on "still near the top" so a
          // user who has since scrolled away isn't yanked back.
          if (cpJumpAnchorSec && document.contains(cpJumpAnchorSec)) {
            var lfCons = document.querySelector(".cp-console");
            if (lfCons) {
              var off = cpJumpAnchorSec.getBoundingClientRect().top - lfCons.getBoundingClientRect().top;
              if (off >= 0 && off < 320) lfCons.scrollTop += off;
            }
          }
        }).catch(function () { try { box.remove(); } catch (e) {} });
      });
    }
    // Navigate to a breadcrumb segment's level (ancestor segments are clickable links). The auth-trail
    // source links are consumed before the pills are built, so we resolve targets from the trail itself:
    //   idx 0  → reseller home.
    //   idx 1  → the Service-Provider ancestor. The SP entry KEY is the SP's display name (observed live:
    //            {key:'IT Pros', P_key:'IT Pros'}), which is exactly this pill's text — so we re-enter the
    //            group's ACTUAL parent SP by name, regardless of whether an SP was entered this session
    //            (cpSpEntry can be null when the group was reached straight from the reseller list, or point
    //            at a DIFFERENT SP). This fixes the SP pill landing on reseller / the wrong SP.
    //   idx 2  → the GROUP ancestor (only clickable at the User level, where group is no longer current).
    //            The group entry KEY is the `SP>%Group` composite (observed: the user key is
    //            `SP>%Group>%User`), rebuilt from the trail texts trail[1]+">%"+trail[2]; re-enters the group
    //            via its Modify entry.
    //   idx 3  → the USERS-LIST ancestor (User level) → the group's Users list /Group/Members/ (the group
    //            context is live, so a plain list nav restores it).
    //   deeper → fall back to cpSpEntry, else reseller.
    function cpCrumbNav(idx, trail) {
      try {
        trail = trail || [];
        var seg = trail[idx] || "";
        // User-id pill (a clickable ANCESTOR on a user sub-page) → re-enter the user = back to the user home
        // console. Rebuild the entry key "SP >% Group >% UserId" from the trail (SP=1, Group=2 once "Users" is
        // dropped), mirroring how the group pill rebuilds its key at idx 2.
        if (/@/.test(seg) && trail[1] && trail[2]) {
          var uk = trail[1] + ">%" + trail[2] + ">%" + seg;
          window.redirectPost("/commpilot/Group/Members/Modify/index.jsp", { key: uk, P_key: uk }); return;
        }
        if (idx === 0) { window.redirectPost("/commpilot/Common/folder_contents.jsp", { folder: "R0", menuId: "8" }); return; }
        if (idx === 1 && trail[1]) { window.redirectPost("/commpilot/Reseller/ServiceProviders/Modify/index.jsp", { key: trail[1], P_key: trail[1] }); return; }
        if (idx === 2 && trail[1] && trail[2]) { var gk = trail[1] + ">%" + trail[2]; window.redirectPost("/commpilot/ServiceProvider/Members/Modify/index.jsp", { key: gk, P_key: gk }); return; }
        if (idx === 3) { window.redirectPost("/commpilot/Group/Members/", {}); return; }
        if (cpSpEntry && cpSpEntry.url) { window.redirectPost(cpSpEntry.url, cpSpEntry.params || {}); return; }
        window.redirectPost("/commpilot/Common/folder_contents.jsp", { folder: "R0", menuId: "8" });
      } catch (e) {}
    }
    // Inline Lucide SVGs for the pill breadcrumb — kept identical to skin.js (CP_BC_ROUTE_SVG/ARROW_SVG) so
    // the console (cpBuildConsole), pjax swaps (cpHook restore), and list/leaf pages (skin.js) all match.
    var CP_BC_ROUTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>';
    var CP_BC_ARROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
    var CP_BC_CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    // Build the PILL TRAIL breadcrumb (Option B) from an array of segment texts. Shared by cpBuildConsole
    // (console pages) and cpHook's restore (list/leaf pjax swaps). Ancestors are clickable via cpCrumbNav;
    // the current/last level is a static pill.
    function cpBuildPillCrumb(trail, idLast, withDd) {
      trail = trail.slice();
      // Is the last pill the current ENTITY id (case-preserved)? Trust the caller's idLast, but also treat
      // an id-looking last segment (contains "@", e.g. a user id) as one — the trail source is inconsistent.
      var lastIsId = !!idLast || /@/.test(trail[trail.length - 1] || "");
      // Drop a redundant/stale "Users" members-list segment anywhere it is NOT the current (last) pill.
      // "Users" is the legit current pill only on a Users LIST page (last segment) — there it stays. The user
      // level carries it as a redundant ancestor, and the un-swapped live header can leak a STALE "Users"
      // into other levels ("Users randomly appears"); both are scrubbed here. The surviving ancestors stay
      // index-aligned for cpCrumbNav. Guard length>2 so a sparse trail can't collapse to just the id.
      if (trail.length > 2) trail = trail.filter(function (s, i) { return !(s === "Users" && i !== trail.length - 1); });
      // Option B: the current pill gets a dropdown of this level's sibling LIST pages (harvested into
      // cpLevelPages, keyed by sidebar signature — stable across a level's home + its list pages).
      var _ddSig = cpSidebarSig(document.querySelector('form[name="leftNavForm"]'));
      var _ddData = (_ddSig && cpLevelPages[_ddSig]) || null;
      var crumb = document.createElement("div");
      crumb.className = "cp-breadcrumb cp-bc-pill";
      var lead = document.createElement("span");
      lead.className = "cp-bc-lead";
      lead.setAttribute("aria-hidden", "true");
      lead.innerHTML = CP_BC_ROUTE_SVG;
      crumb.appendChild(lead);
      trail.forEach(function (seg, i) {
        if (i > 0) {
          var sep = document.createElement("span");
          sep.className = "cp-bc-sep";
          sep.setAttribute("aria-hidden", "true");
          sep.innerHTML = CP_BC_ARROW_SVG;
          crumb.appendChild(sep);
        }
        var isCur = (i === trail.length - 1);
        var segIsId = /@/.test(seg);   // an entity id (e.g. a user id) — keep its real case wherever it sits,
                                        // including as a clickable ANCESTOR on a user sub-page (.cp-bc-id).
        var pill = document.createElement(isCur ? "span" : "a");
        // The last segment is the current pill; an id segment (idLast or id-looking) gets .cp-bc-id so the
        // CSS preserves its case (an id like RSG171001@phonenetwork.net, not an uppercased level name).
        pill.className = isCur
          ? ((lastIsId || segIsId) ? "cp-bc-cur cp-bc-id" : "cp-bc-cur")
          : (segIsId ? "cp-bc-seg cp-bc-id" : "cp-bc-seg");
        pill.textContent = seg;
        if (isCur) {
          pill.setAttribute("aria-current", "page");
          // SUB-MENUS only: pages built by cpHook's restore (lists/leaf/settings) open this level's MEGA menu.
          // The console HOME / base menu (built by cpBuildConsole, withDd=false) stays a plain pill — the menu
          // is for hopping between a level's pages, not for the base menu itself.
          if (withDd) cpAttachCrumbDropdown(pill, _ddData);
        } else {
          pill.setAttribute("role", "link");
          pill.setAttribute("tabindex", "0");
          (function (idx) {
            pill.addEventListener("click", function (e) { e.preventDefault(); cpCrumbNav(idx, trail); });
            pill.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cpCrumbNav(idx, trail); } });
          })(i);
        }
        crumb.appendChild(pill);
      });
      // Transition animation (destination focus): on each nav only the CURRENT pill slides + pops in; the
      // stable ancestors stay put. rAF so it runs after the caller inserts the crumb (WAAPI on a detached
      // node wouldn't paint). cpBuildPillCrumb runs once per crumb build, i.e. once per navigation.
      var animPill = crumb.querySelector(".cp-bc-cur");
      if (animPill) requestAnimationFrame(function () {
        try { animPill.animate([{ opacity: 0, transform: "scale(0.82) translateX(10px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(0.34,1.4,0.64,1)" }); } catch (e) {}
      });
      return crumb;
    }
    // Harvest a level's object-LIST pages (Groups/Users/Administrators/…) from the freshly-built console, so
    // the breadcrumb current-pill dropdown can offer them on the list pages (where the console is gone). Keyed
    // by sidebar signature (stable across a level's home + its list pages). Reads each named candidate's real
    // redirectPost target via a capture-block (swap redirectPost for a recorder, click, restore) — NO
    // navigation. Runs once per level (at reveal completion). Only a handful of named candidates are clicked.
    // Keep ANY /commpilot/<Level>/<Section>… landing page so the mega menu lists EVERY option (incl. deep
    // settings pages like Calling Plan / Communication Barring); exclude folder menus, entity-entry (Modify),
    // and pager URLs. Most are pjax (isPjaxUrl) and open in-shell; any that aren't simply full-navigate.
    function cpHarvestable(u) {
      return /\/commpilot\/[A-Za-z]+\/[A-Za-z]/.test(u) && u.indexOf("folder_contents") === -1 && u.indexOf("/Modify/") === -1 && u.indexOf("page.jsp") === -1 && u.indexOf("sort.jsp") === -1 && u.indexOf("/Login") === -1;
    }
    // Harvest EVERY option of the current level's console, grouped by folder, into
    // cpLevelPages[sidebarSig] = { groups:[{label, items:[{name,url,params}]}] }. Powers the breadcrumb
    // current-pill MEGA menu (jump to any page at this level), uniform across reseller/SP/group/user. Targets
    // are read via a capture-block (swap redirectPost for a recorder, click, restore) — NO navigation. Runs
    // once per level (at reveal completion); then decorates the home crumb (built before the harvest ran).
    function cpHarvestLevelPages(force) {
      try {
        var sig = cpSidebarSig(document.querySelector('form[name="leftNavForm"]'));
        if (!sig) return;
        // Per-section calls skip once cached; the FORCED reveal-completion pass re-harvests (by then every
        // section's option wiring has run, so the last folder — dropped if harvested the tick its content
        // landed but before its re-exec'd scripts wired the links — is captured).
        if (!force && cpLevelPages[sig]) return;
        var secs = Array.prototype.slice.call(document.querySelectorAll(".cp-console-section"));
        if (!secs.length) return;
        // Only harvest once EVERY section has loaded its content — otherwise we'd cache a PARTIAL console (e.g.
        // just Profile during the reveal) and "once per sig" would lock that incomplete result in. Called per
        // section-load AND at reveal completion, so it fires exactly when the last section lands.
        var allLoaded = secs.every(function (s) { var b = s.querySelector(".cp-console-body"); return b && b.getAttribute("data-cp-loaded") === "1"; });
        if (!allLoaded) return;
        var groups = [], orig = window.redirectPost, rec = null;
        window.redirectPost = function (u, p) { rec = { url: u, params: p || {} }; return false; };   // capture, no nav
        try {
          secs.forEach(function (sec) {
            var label = ((sec.querySelector(".cp-console-head-name") || {}).textContent || "").trim();
            var items = [], seen = {};
            sec.querySelectorAll(".cp-console-body a.navMenuItem, .cp-console-body a[id^='link_']").forEach(function (a) {
              var nm = (a.textContent || "").trim(); if (!nm || seen[nm]) return;
              rec = null; try { a.click(); } catch (e) {}
              if (rec && rec.url && cpHarvestable(rec.url)) { items.push({ name: nm, url: rec.url, params: rec.params }); seen[nm] = 1; }
            });
            if (items.length) groups.push({ label: label, items: items });
          });
        } finally { window.redirectPost = orig; }
        // Cache on first harvest, or when a (forced) pass finds AT LEAST as many groups — so a partial
        // per-section result is upgraded to the full set, but a momentarily-smaller pass never clobbers it.
        if (groups.length && (!cpLevelPages[sig] || groups.length >= cpLevelPages[sig].groups.length)) {
          cpLevelPages[sig] = { groups: groups };   // cached for this level's sub-pages
          try { sessionStorage.setItem("cp-level-pages", JSON.stringify(cpLevelPages)); } catch (e) {}   // survive reload
        }
      } catch (e) {}
    }
    // Attach the mega-menu trigger (chevron + handlers) to a sub-page's current breadcrumb pill (cpBuildPillCrumb).
    function cpAttachCrumbDropdown(pill, data) {
      if (!data || !data.groups || !data.groups.length || !pill || pill.classList.contains("cp-bc-has-dd")) return;
      pill.classList.add("cp-bc-has-dd");
      pill.setAttribute("role", "button");
      pill.setAttribute("tabindex", "0");
      pill.setAttribute("aria-haspopup", "menu");
      var chev = document.createElement("span");
      chev.className = "cp-bc-dd-chev";
      chev.setAttribute("aria-hidden", "true");
      chev.innerHTML = CP_BC_CHEV_SVG;
      pill.appendChild(chev);
      pill.addEventListener("click", function (e) { e.preventDefault(); cpToggleCrumbDropdown(pill, data); });
      pill.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cpToggleCrumbDropdown(pill, data); } });
    }
    // Attach the mega menu to a FULL-LOAD sub-page's crumb. On reload/recovery the page is a real navigation,
    // so skin.js (cpMoveBreadcrumb, ISOLATED world) builds the crumb and can't reach this pjax-world dropdown
    // — pjax then decorates it here (from cpAutoConsole's list/leaf branch). Idempotent (cpAttachCrumbDropdown
    // no-ops if already decorated, so pjax-swap pages that already have it are untouched). No-op until the
    // level is harvested (cache persisted across reloads via sessionStorage).
    function cpDecorateCurrentCrumbPill() {
      var sig = cpSidebarSig(document.querySelector('form[name="leftNavForm"]'));
      var data = sig && cpLevelPages[sig];
      var crumb = document.querySelector(".cp-breadcrumb.cp-bc-pill");
      if (data && crumb) cpAttachCrumbDropdown(crumb.querySelector(".cp-bc-cur"), data);
    }
    function cpCloseCrumbDropdown() {
      if (!cpCrumbDd) return;
      try { if (cpCrumbDd.teardown) cpCrumbDd.teardown(); } catch (e) {}
      try { if (cpCrumbDd.el && cpCrumbDd.el.parentNode) cpCrumbDd.el.parentNode.removeChild(cpCrumbDd.el); } catch (e) {}
      if (cpCrumbDd.trigger) cpCrumbDd.trigger.classList.remove("cp-bc-dd-open");
      cpCrumbDd = null;
    }
    // Open (or toggle) the current-pill MEGA menu: this level's pages grouped by folder, two columns. The page
    // matching the current URL is highlighted (robust vs the pill text). Picks navigate via the normal pjax
    // redirectPost. Fixed under the pill, clamped to the viewport; closes on outside-click / Esc / OUTSIDE scroll.
    function cpToggleCrumbDropdown(anchorEl, data) {
      if (cpCrumbDd && cpCrumbDd.trigger === anchorEl) { cpCloseCrumbDropdown(); return; }
      cpCloseCrumbDropdown();
      var norm = function (u) { return (u || "").split("?")[0].replace(/index\.jsp$/, "").replace(/\/+$/, ""); };
      var curPath = norm(location.pathname);
      var dd = document.createElement("div");
      dd.className = "cp-bc-dd cp-bc-dd-mega";
      dd.setAttribute("role", "menu");
      data.groups.forEach(function (g) {
        var gw = document.createElement("div"); gw.className = "cp-bc-dd-grp";
        if (g.label) { var gh = document.createElement("div"); gh.className = "cp-bc-dd-ghead"; gh.textContent = g.label; gw.appendChild(gh); }
        dd.appendChild(gw);
        g.items.forEach(function (pg) {
          var isCurItem = norm(pg.url) === curPath;
          var item = document.createElement("a");
          item.className = "cp-bc-dd-item" + (isCurItem ? " cp-bc-dd-cur" : "");
          item.setAttribute("role", "menuitem");
          item.textContent = pg.name;
          item.addEventListener("click", function (e) {
            e.preventDefault();
            cpCloseCrumbDropdown();
            if (!isCurItem) window.redirectPost(pg.url, pg.params || {});
          });
          gw.appendChild(item);
        });
      });
      document.body.appendChild(dd);
      // Fixed under the trigger. In console mode scrollbar-gutter is auto (no drift), but subtract the html
      // rect left anyway so it self-corrects if a gutter is ever present (see scrollbar-gutter-fixed-drift).
      // The current pill is the rightmost, so a wide (mega) menu is clamped to stay within the viewport.
      var r = anchorEl.getBoundingClientRect();
      var hx = document.documentElement.getBoundingClientRect().left;
      var vw = document.documentElement.clientWidth;
      var left = r.left - hx;
      if (left + dd.offsetWidth > vw - 12) left = Math.max(12, vw - 12 - dd.offsetWidth);
      dd.style.top = (r.bottom + 6) + "px";
      dd.style.left = left + "px";
      anchorEl.classList.add("cp-bc-dd-open");
      var onDocClick = function (e) { if (dd.contains(e.target) || anchorEl.contains(e.target)) return; cpCloseCrumbDropdown(); };
      var onKey = function (e) { if (e.key === "Escape") cpCloseCrumbDropdown(); };
      var onScroll = function (e) { if (e && e.target && dd.contains(e.target)) return; cpCloseCrumbDropdown(); };   // ignore scrolling WITHIN the menu
      var cons = document.querySelector(".cp-console");
      cpCrumbDd = { el: dd, trigger: anchorEl, teardown: function () {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("scroll", onScroll, true);
        if (cons) cons.removeEventListener("scroll", onScroll, true);
      } };
      setTimeout(function () {
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        if (cons) cons.addEventListener("scroll", onScroll, true);
      }, 0);
    }
    function cpBuildConsole() {
      if (document.querySelector(".cp-console")) return;
      var contentCell = document.querySelector('td[width="82%"]');
      if (!contentCell) return;
      cpSectionAborted = false;
      // Enumerate folders from the sidebar
      var folders = [];
      var navAnchors = document.querySelectorAll('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen');
      navAnchors.forEach(function (a) {
        var name = (a.textContent || "").trim().split(/\n/)[0].trim();
        if (!name) return;
        var folder = "", menuId = "8";
        var onclick = a.getAttribute("onclick") || "";
        // Folder ids are level-scoped, NOT just reseller R0..R5: the Service Provider level uses
        // S0,S1,S2,S5,S3 (S-prefixed, non-contiguous) with menuId 2, and Group/User levels use their
        // own letter prefixes. Match any single-letter+digits id so the console enumerates folders at
        // every level (menuId is parsed dynamically below). Reseller R-ids still match unchanged.
        var fm = /folder\s*:\s*['"]([A-Z]\d+)['"]/i.exec(onclick);
        if (fm) folder = fm[1];
        var mm = /menuId\s*:\s*['"](\d+)['"]/i.exec(onclick);
        if (mm) menuId = mm[1];
        if (!folder) {
          var el = a;
          for (var hop = 0; hop < 4 && el; hop++) {
            var scripts = el.querySelectorAll("script");
            for (var si = 0; si < scripts.length; si++) {
              var txt = scripts[si].textContent || "";
              // Read menuId FIRST — the folder + menuId live in the SAME redirectPost({folder:'S1',menuId:'2'})
              // call, so breaking on the folder match before reading menuId left menuId at its "8" default.
              // That made SP folders (which need menuId:2) post folder_contents{Sn,menuId:8} → server SHELL.
              var mm2 = /menuId['"\s:,]+(\d+)/.exec(txt);
              if (mm2) menuId = mm2[1];
              var fm2 = /folder['"\s:,]+([A-Z]\d+)/.exec(txt);
              if (fm2) { folder = fm2[1]; break; }
            }
            if (folder) break;
            el = el.parentNode;
          }
        }
        if (!folder) return;
        a.setAttribute("data-cp-folder", folder);
        folders.push({ name: name, folder: folder, menuId: menuId });
      });
      if (folders.length === 0) return;
      // LEVEL GATE: build the aggregated one-scroll console where we can retrieve every folder's content.
      // Reseller (R-ids) loads via plain background fetch. The Service-Provider (S), Group (G) and User (U)
      // levels load each folder via cpAggNavigate (the BARE {folder,menuId} sidebar-click params over
      // cpFollowFrame — see the agg transport notes); the menuId is read per-folder from the wiring (R=8,
      // S=2, G=1, U=0), so the same machinery serves every level. Any other prefix stays native until wired.
      if (!folders.every(function (f) { return /^[RSGU]\d+$/.test(f.folder); })) return;
      var aggLevel = !folders.every(function (f) { return /^R\d+$/.test(f.folder); });
      // SWITCHER (debug/fallback): at non-reseller levels, localStorage.cpSpAgg === "0" forces the
      // single-folder mode (skip the aggregated build → native menu in the shell, sidebar clicks
      // foreground-navigate). Any other value (incl. unset) = aggregate. Reseller ignores it.
      try { if (aggLevel && localStorage.getItem("cpSpAgg") === "0") return; } catch (e) {}
      // DEDUP GUARD: on entry, cpAutoConsole fires TWICE (cp:reskin then a second reskin/morph), so
      // cpBuildConsole runs twice. At aggLevel that would start TWO concurrent cpAggPrefetch walks racing the
      // single-use formtokenserial — they stomp each other and both shell. Bail the dup while a prefetch/
      // reveal is already in flight (cpAggActive set in cpAggBegin, cleared in cpAggEnd at reveal end).
      if (aggLevel && cpAggActive) return;
      // LEAVING an SP/aggregation console for a reseller (non-agg) one: clear stale aggregation state.
      // cpFetchSection's `if (cpAggActive)` branch runs BEFORE the live fetch, so if a previous SP build's
      // cpAggActive is still set (its reveal not yet finished — e.g. clicking the RESELLER breadcrumb while
      // the SP console is still building), this reseller console's section loads route through cpAggNavigate,
      // whose cache holds only the PREVIOUS (S) folders → null → "Couldn't load". Profile (fetched first) is
      // the usual casualty; an instant click shells ALL sections. Clearing it here forces the live fetch path.
      if (!aggLevel) cpAggEnd();
      // Capture the entry's OPEN folder + its already-fetched menu HTML NOW — before the cell is wiped.
      // The open folder is the one cpHook just navigated to, which is ALSO the console's anchor section,
      // so reusing this avoids re-requesting it. SP seeds it into cpAggCache (cpAggBegin); reseller stores
      // it in the one-shot cpEntry* cache that cpFetchSection consults. Strip the breadcrumb so it doesn't
      // leak into the section card. (At reseller, dropping the redundant anchor fetch also kills the
      // back-to-back folder_contents that intermittently shelled Profile on the SP→reseller breadcrumb.)
      cpEntryFolder = null; cpEntryHtml = null;   // reset fresh per build
      var openA = document.querySelector('form[name="leftNavForm"] a.leftnavfolderopen');
      var entryFolder = openA ? openA.getAttribute("data-cp-folder") : null;
      var entryHtml = null;
      if (entryFolder) {
        var cellClone = contentCell.cloneNode(true);
        cellClone.querySelectorAll(".cp-breadcrumb").forEach(function (b) { b.remove(); });
        entryHtml = cellClone.innerHTML;
      }
      var aggAnchorFolder = aggLevel ? entryFolder : null;
      var aggAnchorHtml = aggLevel ? entryHtml : null;
      if (!aggLevel) { cpEntryFolder = entryFolder; cpEntryHtml = entryHtml; }
      // Build console DOM
      var consoleDiv = document.createElement("div");
      consoleDiv.className = "cp-console";
      // Breadcrumb header — built here, inserted into the content cell ABOVE .cp-console
      // (below) so it stays pinned while the console scrolls internally.
      // Breadcrumb — derive the REAL level trail (Reseller; Reseller › <SP>; …) rather than
      // hardcoding "Reseller". Source the segments from the live auth links if present, else from an
      // already-built .cp-breadcrumb (skin.js/pjax), else fall back to "Reseller". Captured BEFORE the
      // content cell is wiped below.
      var trail = [];
      var pushSeg = function (t) { if (t && trail[trail.length - 1] !== t) trail.push(t); };   // dedupe consecutive (the auth links can repeat "Reseller")
      // Prefer the FRESH crumb cpHook (pjax) / cpMoveBreadcrumb (full load) just built from the FETCHED doc.
      // The live header's a.headerAuthLevelLink are STALE on a pjax swap (the header isn't swapped — the same
      // reason cpCurEntity exists) and leak the PREVIOUS level's segments — that's what made "Users" randomly
      // appear at other levels. Read the just-built crumb first; the live links are only the fresh-load fallback.
      var existingCrumb = document.querySelector(".cp-breadcrumb");
      if (existingCrumb) existingCrumb.querySelectorAll(".cp-bc-seg, .cp-bc-cur, a").forEach(function (a) { pushSeg((a.textContent || "").trim()); });
      if (!trail.length) document.querySelectorAll("a.headerAuthLevelLink").forEach(function (a) { pushSeg((a.textContent || "").trim()); });
      if (!trail.length) trail = ["Reseller"];
      // Current ENTITY (e.g. a user id) → the breadcrumb's last pill (like the live site's "… Users : id").
      // The entity lives in span.headerAuthLevel, which is in the HEADER — but the header isn't swapped on a
      // pjax nav, so it holds the PREVIOUS entity (stale), and the fresh content cell has none. So prefer
      // cpCurEntity, stashed by the last cpHook swap from the FETCHED doc (fresh per level; "" for reseller/
      // SP/group). Only on a fresh page load (no swap yet — cpCurEntity null) is the live header reliable.
      var _tl = trail.length;
      var _ent = (cpCurEntity !== null)
        ? cpCurEntity
        : (function () { var h = document.querySelector("span.headerAuthLevel"); return h ? (h.textContent || "").replace(/^\s*:\s*/, "").trim() : ""; })();
      if (_ent) pushSeg(_ent);
      var crumb = cpBuildPillCrumb(trail, trail.length > _tl, false);   // base/home menu → no dropdown (sub-menus only)
      folders.forEach(function (f) {
        var sec = document.createElement("section");
        sec.className = "cp-console-section";
        sec.setAttribute("data-cp-folder", f.folder);
        sec.setAttribute("data-cp-menuid", f.menuId);   // read by cpLoadAndRevealSection (sequential reveal)
        var head = document.createElement("div");
        head.className = "cp-console-head";
        // Inner wrapper holds the fading content (icon + name + count) so the head's solid
        // background can stay put and mask the cards while the content fades on scroll.
        var headInner = document.createElement("div");
        headInner.className = "cp-console-head-inner";
        var headIco = document.createElement("span");
        headIco.className = "cp-console-head-ico";   // per-folder glyph; mask set by skin.js
        var headName = document.createElement("span");
        headName.className = "cp-console-head-name";
        headName.textContent = f.name;
        var headCount = document.createElement("span");
        headCount.className = "cp-console-count";
        headCount.hidden = true;
        headInner.appendChild(headIco);
        headInner.appendChild(headName);
        headInner.appendChild(headCount);
        head.appendChild(headInner);
        var bodyEl = document.createElement("div");
        bodyEl.className = "cp-console-body";
        var loading = document.createElement("div");
        loading.className = "cp-console-loading";
        loading.textContent = "Loading\u2026";
        bodyEl.appendChild(loading);
        sec.appendChild(head);
        sec.appendChild(bodyEl);
        consoleDiv.appendChild(sec);
      });
      // MOUNT = wipe the cell, insert the console skeleton, wire it. Sequential-expand reveal (Option A):
      // every section starts HIDDEN, then reveals top-down from the anchor as each loads, cards cascading
      // (staggerCards), masking the load.
      var mountConsole = function () {
        while (contentCell.firstChild) contentCell.removeChild(contentCell.firstChild);
        contentCell.appendChild(crumb);
        contentCell.appendChild(consoleDiv);
        consoleDiv.querySelectorAll(".cp-console-section").forEach(function (s) { s.style.display = "none"; });
        cpSyncConsoleClass();
        cpWireConsoleScroll();
        cpEnsureSubmenuScaffold();
        cpHeadFade();
      };
      // Anchor on the entry's open folder at aggregation levels (its cached content reveals first, then the
      // rest fill from cache); reseller keeps the pending-folder jump.
      var startReveal = function () {
        cpStartRevealSequence(aggLevel ? (cpPendingFolder || aggAnchorFolder) : cpPendingFolder);
      };
      if (aggLevel) {
        // MOUNT THE SKELETON IMMEDIATELY so the single-folder entry page doesn't FLASH before the aggregated
        // console appears. The pre-fetch loads use the captured token + session (cpFollowFrame POSTs from
        // document.body, not the visible cell), so wiping the static menu first is safe.
        cpAggBegin(aggAnchorFolder, aggAnchorHtml);
        mountConsole();
        // Reveal the ANCHOR section (Profile) RIGHT AWAY from its entry cache — its cards cascade in as the
        // visual "hider", so no standalone "Loading…" placeholder is needed (same as the reseller console,
        // where the card cascade masks the per-section load). The remaining folders pre-fetch in the
        // background and cascade in below once cpAggCache is filled.
        var aggAnchorSec = aggAnchorFolder && consoleDiv.querySelector('.cp-console-section[data-cp-folder="' + aggAnchorFolder + '"]');
        if (aggAnchorSec) cpLoadAndRevealSection(aggAnchorSec, false, aggAnchorSec, null);
        // Kick off the sequential prefetch and start the reveal CONCURRENTLY (don't await the whole walk).
        // Each reveal step awaits only its own folder's deferred (cpAggNavigate), so sections cascade in as
        // their loads land — anchor instant, then S1 the moment it resolves, etc. — instead of anchor → a
        // ~500ms dead gap (all 4 folders) → burst. Matches the reseller console's continuous trickle.
        cpAggPrefetch(folders);
        startReveal();   // anchor already revealed (skipped as loaded); the rest reveal progressively from cache
      } else {
        mountConsole();
        startReveal();
      }
    }

    // Shared: set the active sidebar folder highlight by folder id (R0..R5), and drive the
    // submenu accordion — the active folder's submenu opens and all others close (single-open,
    // synced to scroll-spy + folder click, both of which call this).
    function cpHighlightFolder(fid) {
      if (!fid) return;
      document.querySelectorAll('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen').forEach(function (o) {
        var on = o.getAttribute("data-cp-folder") === fid;
        o.classList.toggle("leftnavfolderopen", on);
        o.classList.toggle("leftnavfolder", !on);
        var host = o.closest("td") || o.parentNode;
        if (host && host.classList) host.classList.toggle("cp-grp-open", on);
      });
    }

    // Add a chevron + an (empty) collapsible submenu container under each sidebar folder.
    // Idempotent. Submenus are filled per-folder as the console sections lazy-load.
    function cpEnsureSubmenuScaffold() {
      document.querySelectorAll('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen').forEach(function (a) {
        var fid = a.getAttribute("data-cp-folder");
        if (!fid || a.querySelector(".cp-fold-chev")) return;
        var chev = document.createElement("span");
        chev.className = "cp-fold-chev";
        a.appendChild(chev);
        var sm = document.createElement("div");
        sm.className = "cp-submenu";
        sm.setAttribute("data-cp-folder", fid);
        sm.innerHTML = '<div class="cp-submenu-in"><div class="cp-submenu-panel"></div></div>';
        if (a.parentNode) a.parentNode.insertBefore(sm, a.nextSibling);
      });
    }

    // Fill a folder's submenu from its console section's card options (title + click-through
    // to the real card anchor, which carries the existing nav wiring — no extra fetch).
    function cpPopulateSubmenu(folder, bodyEl) {
      if (!folder || !bodyEl) return;
      var panel = document.querySelector('.cp-submenu[data-cp-folder="' + folder + '"] .cp-submenu-panel');
      if (!panel) return;
      panel.innerHTML = "";
      bodyEl.querySelectorAll(".cp-menu-card").forEach(function (card) {
        var link = card.querySelector(".cp-card-title a.navMenuItem") || card.querySelector("a.navMenuItem") || card.querySelector('a[id^="link_"]');
        if (!link) return;
        var title = (link.textContent || "").trim();
        if (!title) return;
        var item = document.createElement("a");
        item.className = "cp-subitem";
        // Mirror the card's per-item icon (single source of truth) — lit if assigned, dashed placeholder if not.
        var cico = card.querySelector(".cp-card-ico");
        var lit = cico && !cico.classList.contains("cp-card-ico-todo");
        var si = document.createElement("span");
        si.className = "cp-subitem-ico" + (lit ? "" : " cp-subitem-ico-todo");
        if (lit) si.innerHTML = cico.innerHTML;
        var lbl = document.createElement("span");
        lbl.className = "cp-subitem-lbl";
        lbl.textContent = title;
        item.appendChild(si);
        item.appendChild(lbl);
        item.title = title;
        item.addEventListener("click", function (e) {
          e.preventDefault();
          if (link && document.contains(link)) link.click();
        });
        panel.appendChild(item);
      });
    }

    // Trailing space so the LAST section can scroll all the way to the top of the panel
    // (otherwise the console bottoms out with the last section only partway up). A trailing
    // SPACER div is used, not padding-bottom — padding-bottom is NOT counted as scrollable
    // overflow in a flex column (verified live: it never grew scrollHeight), whereas a child
    // element always does. Height = console viewport − last section height; recomputed as
    // sections lazy-load and on scroll, so it self-adjusts to real heights and viewport size.
    function cpFitConsoleTail() {
      var cons = document.querySelector(".cp-console");
      if (!cons) return;
      var secs = cons.querySelectorAll(".cp-console-section");
      if (!secs.length) return;
      // Last VISIBLE section — during the sequential-expand reveal the not-yet-revealed sections are
      // display:none (offsetParent null); sizing the tail off a hidden last section would reserve a
      // full panel's worth of empty scroll space mid-cascade.
      var last = null;
      for (var li = secs.length - 1; li >= 0; li--) { if (secs[li].offsetParent !== null) { last = secs[li]; break; } }
      if (!last) return;
      var tail = cons.querySelector(".cp-console-tail");
      if (!tail) {
        tail = document.createElement("div");
        tail.className = "cp-console-tail";
        tail.style.cssText = "flex:0 0 auto;pointer-events:none;";
        cons.appendChild(tail);
      } else if (tail !== cons.lastElementChild) {
        cons.appendChild(tail);   // keep it last if a section was (re)appended after it
      }
      // While the reveal sequence runs, reserve a FULL viewport of tail below the last revealed
      // section so the anchor re-pin always has enough scroll headroom to pull the anchor flush to the
      // top — otherwise, jumping to a section near the bottom (Utilities/Meet-Me), the first
      // above-sections can't be scrolled past (scrollTop clamps at maxScrollTop) and they paint at the
      // top until later sections load (the "Call Center / Meet-Me pops up" flash). Use the STABLE
      // viewport height, NOT cons.clientHeight: right after the pjax swap the panel is still sizing up
      // (measured live at 554px on the first reveal, then 1112px) so a clientHeight-based tail is far
      // too short exactly when headroom matters most. window.innerHeight is stable from frame 1 and is
      // always ≥ the panel's final height (the panel is capped at vh − chrome). Tight tail (so the last
      // section can still reach the top) is restored when the sequence completes (cpRevealBusy false).
      var hpx = (cpRevealBusy ? Math.max(cons.clientHeight, window.innerHeight || 0)
                              : Math.max(0, cons.clientHeight - last.offsetHeight)) + "px";
      if (tail.style.height !== hpx) tail.style.height = hpx;
    }

    // Scroll-spy: highlight the sidebar folder for the section currently pinned at the top
    // of the panel — the last section whose top has reached the active line below the top.
    function cpScrollSpy() {
      // Skip while a folder-click smooth-scroll is in flight. The click sets the active folder
      // directly, but for the scroll's first frames the console is still at its OLD position, so
      // the spy would re-pick the old top-of-viewport folder — flipping the accordion back, then
      // forward again as the scroll arrives. That open/close read as a 2-frame "jump".
      if (Date.now() < cpSpySuppressUntil) return;
      var cons = document.querySelector(".cp-console");
      if (!cons) return;
      var secs = cons.querySelectorAll(".cp-console-section");
      if (!secs.length) return;
      var consTop = cons.getBoundingClientRect().top;
      var line = 90;
      var active = secs[0];
      for (var i = 0; i < secs.length; i++) {
        if (secs[i].getBoundingClientRect().top - consTop <= line) active = secs[i];
        else break;
      }
      cpHighlightFolder(active.getAttribute("data-cp-folder"));
    }

    var cpSpyRaf = 0;
    var cpSpySuppressUntil = 0;
    var cpPendingFolder = null;
    // The section a jump landed on (non-top anchor only). Kept so that late async content growth in a
    // section ABOVE it (e.g. Profile's leaf-summary fetch resolving after the cascade) can re-pin the
    // anchor flush instead of letting it jump down. Re-set each reveal sequence; gated on "still near
    // the top" at re-pin time so a user who has scrolled away isn't yanked back.
    var cpJumpAnchorSec = null;
    // True while the reveal sequence is running. The chain makes programmatic re-pin scrolls; if the
    // console's scroll handler runs on those it lets the scroll-spy briefly open the accordion of the
    // section that flickered to the top, and cpFitConsoleTail can nudge the scroll — the "Call Center
    // pops up for a frame" flash. Gate the handler off while revealing.
    var cpRevealBusy = false;
    // Sequential-expand reveal: sections load + reveal STRICTLY one at a time (cpRevealStep chain) —
    // the next section's fetch doesn't even start until the previous has loaded, revealed, and this
    // dwell elapsed. So the top-down cascade is unmistakably sequential (Profile loads, finishes,
    // THEN Resources…) regardless of how fast the fetches resolve. Tune the cadence here.
    var CP_REVEAL_DWELL = 250;
    // Sticky-header fade-on-scroll (Fade + shrink). As an outgoing .cp-console-head is pushed up
    // by the next section, fade ONLY its inner content (icon+name+count) — opacity reaches 0 once
    // it's pushed up by 30% of the header height — plus a slight scale-down. The head's background
    // stays SOLID, masking the cards behind it (no peek-through). Cheap; runs in the scroll rAF.
    function cpHeadFade() {
      var cons = document.querySelector(".cp-console");
      if (!cons) return;
      var consTop = cons.getBoundingClientRect().top;
      cons.querySelectorAll(".cp-console-head").forEach(function (head) {
        var inner = head.querySelector(".cp-console-head-inner");
        if (!inner) return;
        var hr = head.getBoundingClientRect();
        var top = hr.top - consTop;
        var H = head.offsetHeight || 50;
        var p = top < 0 ? Math.max(0, Math.min(1, 1 + top / (H * 0.30))) : 1;
        inner.style.opacity = p;
        inner.style.transform = top < 0 ? ("scale(" + (0.9 + 0.1 * p).toFixed(3) + ")") : "";
        // Drive the bottom-edge gradient (.cp-console-head::after, opacity:var(--cp-head-fade,0)):
        // 0 when the section is parked (body starts flush under the head → labels crisp), ramping to 1
        // as the body scrolls UP under the pinned header. body is the head's next sibling (.cp-console-body).
        var body = head.nextElementSibling;
        if (body) {
          var under = hr.bottom - body.getBoundingClientRect().top;
          head.style.setProperty("--cp-head-fade", Math.max(0, Math.min(1, under / 16)).toFixed(3));
        }
      });
    }
    // Load ONE console section (fetch its folder content → swap it in → re-skin + wire submenu/counts
    // → reveal it), then invoke `done` so the strict chain (cpRevealStep) can advance to the next.
    // Sections start hidden; cpRevealSection slides this one in JUST BEFORE the reskin so the section
    // fade AND its card cascade both play visibly. `done` is always called (even on failure) so a bad
    // section never stalls the chain. Reads folder + menuId from the section element.
    function cpLoadAndRevealSection(sec, aboveAnchor, anchorSec, done) {
      var bodyEl = sec && sec.querySelector(".cp-console-body");
      // Bail if this section was detached by a newer build / level change (a superseded reveal sequence from a
      // previous console — e.g. the old SP reveal still ticking after we swapped to reseller). Without the
      // document.contains(sec) check it would still issue a (wasted, token-rotating) fetch for a section that
      // is no longer in the DOM, racing the live console's own loads.
      if (!bodyEl || !document.contains(sec) || !document.querySelector(".cp-console")) { if (done) done(); return; }
      if (bodyEl.getAttribute("data-cp-loaded") === "1" || bodyEl.dataset.cpRequested === "1") { if (done) done(); return; }
      bodyEl.dataset.cpRequested = "1";
      var folder = sec.getAttribute("data-cp-folder");
      var mId = sec.getAttribute("data-cp-menuid") || "8";
      cpFetchSection(folder, mId).then(function (html) {
        if (cpSectionAborted || !sec || !document.contains(sec) || !document.querySelector(".cp-console")) { if (done) done(); return; }
        if (html) {
          bodyEl.innerHTML = html;
          bodyEl.setAttribute("data-cp-loaded", "1");
          // Drop the embedded page breadcrumb (the auth-level trail links) from the fetched folder content
          // BEFORE cp:reskin — otherwise skin.js converts each one into a per-section .cp-breadcrumb under
          // every header. The console shows ONE breadcrumb, pinned at the top of the panel (built in
          // cpBuildConsole). Also clears any already-converted crumb that rode in via the anchor cache.
          bodyEl.querySelectorAll(".cp-breadcrumb, a.headerAuthLevelLink").forEach(function (b) { b.remove(); });
          cpRevealSection(sec, aboveAnchor);   // animated cascade for anchor + below; plain show for above
          document.dispatchEvent(new Event("cp:reskin"));   // wrapMenuCards etc. → the section's FINAL height
          cpReexecWiringScripts(bodyEl);
          cpSetSectionCount(bodyEl);
          cpSummarizeLeaves(bodyEl);
          cpPopulateSubmenu(folder, bodyEl);
          // An above-anchor section was just inserted above the pinned anchor. Re-pin the anchor flush
          // to the console top — an ABSOLUTE, idempotent scroll (sets the exact position, no per-section
          // delta to accumulate so nothing drifts), the same alignment the sidebar click uses. After
          // reskin, so heights are final.
          if (aboveAnchor && anchorSec && document.contains(anchorSec)) {
            var rpCons = document.querySelector(".cp-console");
            if (rpCons) {
              rpCons.scrollTop += (anchorSec.getBoundingClientRect().top - rpCons.getBoundingClientRect().top);
              // Anchor re-pinned: reveal any above-section now sitting fully off-screen above the
              // viewport. One still poking into view (a clamp) stays hidden and is flipped by a later
              // re-pin or by cpRevealStep on completion — so it never paints at the top.
              cpRevealAboveOffscreen(rpCons);
            }
          }
          cpFitConsoleTail();
          cpHeadFade();
          cpHarvestLevelPages();   // harvests once ALL sections are loaded (guarded) — robust vs reveal timing
        } else {
          cpRevealSection(sec, aboveAnchor);
          bodyEl.innerHTML = "";
          var retryBtn = document.createElement("button");
          retryBtn.textContent = "Couldn’t load — Retry";
          retryBtn.style.cssText = "background:none;border:1px solid var(--cp-border, #3c3a37);border-radius:6px;padding:6px 14px;color:var(--cp-text, #e8e8e8);cursor:pointer;font:inherit;";
          retryBtn.addEventListener("click", function () {
            bodyEl.innerHTML = "";
            var ld = document.createElement("div");
            ld.className = "cp-console-loading";
            ld.textContent = "Loading…";
            bodyEl.appendChild(ld);
            delete bodyEl.dataset.cpRequested;
            bodyEl.removeAttribute("data-cp-loaded");
            cpLoadAndRevealSection(sec, aboveAnchor, anchorSec, null);
          });
          bodyEl.appendChild(retryBtn);
        }
        if (done) done();
      });
    }

    // Reveal a section that started hidden (sequential expand). Two modes:
    //  • Normal (anchor + sections BELOW it): show it + a soft slide-in; its cards then cascade via
    //    staggerCards (skin.js). This is the visible top-down expand.
    //  • aboveAnchor (sections ABOVE the jumped-to anchor): off-screen above the pinned anchor — just
    //    show it, no entrance animation. The caller then RE-PINS the anchor flush (absolute scroll) so
    //    these never paint at the top (the "Meet-Me flashes" bug) and never shift the anchor.
    //    Idempotent (data-cp-revealed).
    function cpRevealSection(sec, aboveAnchor) {
      if (!sec || sec.dataset.cpRevealed === "1") return;
      sec.dataset.cpRevealed = "1";
      if (aboveAnchor) {
        // Off-screen above the pinned anchor. Reveal it into LAYOUT (so it occupies space and the
        // re-pin can scroll the anchor flush above it) but keep it INVISIBLE until the re-pin has
        // confirmed it sits fully off-screen above the viewport. This is the belt-and-suspenders that
        // guarantees the above-sections can never paint at the top: even if a frame's re-pin clamps
        // (e.g. layout still settling), an invisible section shows nothing. cpLoadAndRevealSection
        // flips it visible once its bottom is at/above the console top; cpRevealStep flips any
        // stragglers visible on completion. No entrance animation (it's off-screen anyway). The caller
        // scroll-compensates AFTER reskin, once the section's final height is known — compensating here
        // would use the pre-card-wrap height and the anchor would jump.
        sec.style.display = "";
        sec.style.visibility = "hidden";
        return;
      }
      sec.style.display = "";
      try {
        sec.animate(
          [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 340, easing: "cubic-bezier(0,0,0.2,1)" }
        );
      } catch (e) {}
    }

    // Flip any visibility:hidden above-anchor section to visible once it sits fully off-screen above
    // the console viewport (its bottom at/above the console top). Called after each above re-pin so a
    // section is only ever shown when it can't paint inside the viewport. Idempotent.
    function cpRevealAboveOffscreen(cons) {
      if (!cons) return;
      var cTop = cons.getBoundingClientRect().top;
      cons.querySelectorAll('.cp-console-section[data-cp-revealed="1"]').forEach(function (s) {
        if (s.style.visibility !== "hidden") return;
        if (s.getBoundingClientRect().bottom - cTop <= 1) s.style.visibility = "";
      });
    }

    // Drive the sequential-expand order: ANCHOR section first, then DOWN to the last, then UP to fill
    // the sections above the anchor (those reveal off-screen above the pinned anchor, so scroll-up
    // stays seamless). Anchor = the jumped-to folder, else the top (Profile). Hands the order to the
    // strict chain (cpRevealStep) — one section loads+reveals fully before the next begins.
    function cpStartRevealSequence(anchorFolder) {
      var cons = document.querySelector(".cp-console");
      if (!cons) return;
      cons.style.overflowAnchor = "none";   // we manage the scroll during reveal; stop the browser's own scroll-anchoring from fighting our re-pin
      var secs = cons.querySelectorAll(".cp-console-section");
      if (!secs.length) return;
      var anchorIdx = 0;
      if (anchorFolder) {
        for (var i = 0; i < secs.length; i++) {
          if (secs[i].getAttribute("data-cp-folder") === anchorFolder) { anchorIdx = i; break; }
        }
      }
      cpHighlightFolder(secs[anchorIdx].getAttribute("data-cp-folder"));
      cpPendingFolder = null;   // anchor is baked into `order` below; the flag's job is done
      cpJumpAnchorSec = anchorIdx > 0 ? secs[anchorIdx] : null;   // only a non-top jump needs late re-pinning
      cpRevealBusy = true;      // gate the scroll handler until the chain completes (cpRevealStep clears it)
      var order = [];
      for (var d = anchorIdx; d < secs.length; d++) order.push(d);          // anchor → bottom (visible cascade)
      for (var u = anchorIdx - 1; u >= 0; u--) order.push(u);               // then above (fills off-screen, scroll-compensated)
      cpRevealStep(secs, order, 0);
    }

    // Strict sequential chain: load + reveal ONE section, and only after it has revealed (+ a short
    // dwell so it's visibly settled) start the NEXT one. Nothing overlaps — this is the "Profile
    // loads, finishes, THEN Resources…" behaviour. Sections ABOVE the anchor (order[i] < order[0])
    // reveal off-screen with scroll compensation and no dwell (they're not part of the visible
    // cascade, just preloaded for seamless scroll-up). Robust to fast fetches (the dwell, not the
    // network, sets the cadence) and to slow ones (each still waits for its own load to finish).
    function cpRevealStep(secs, order, i) {
      if (cpSectionAborted || !document.querySelector(".cp-console")) { cpRevealBusy = false; cpAggEnd(); return; }
      if (i >= order.length) {
        cpAggEnd();   // walk complete — clear the agg cursor/token/flags
        // Sequence complete — re-enable the scroll handler + restore the proper (tight) tail. Also
        // reveal any above-section still held invisible (one that never got confirmed off-screen, e.g.
        // a residual clamp) so nothing is left hidden.
        cpRevealBusy = false;
        var cdone = document.querySelector(".cp-console");
        if (cdone) cdone.querySelectorAll(".cp-console-section").forEach(function (s) { if (s.style.visibility) s.style.visibility = ""; });
        cpFitConsoleTail();
        cpHarvestLevelPages(true);   // FORCE a complete re-harvest now that every section's wiring has run
        return;
      }
      var sec = secs[order[i]];
      if (!sec || !document.contains(sec)) { cpRevealStep(secs, order, i + 1); return; }
      var aboveAnchor = order[i] < order[0];   // order[0] is the anchor's DOM index
      cpLoadAndRevealSection(sec, aboveAnchor, secs[order[0]], function () {
        setTimeout(function () { cpRevealStep(secs, order, i + 1); }, aboveAnchor ? 0 : CP_REVEAL_DWELL);
      });
    }

    function cpWireConsoleScroll() {
      var cons = document.querySelector(".cp-console");
      if (!cons || cons.dataset.cpSpyWired === "1") return;
      cons.dataset.cpSpyWired = "1";
      cons.addEventListener("scroll", function () {
        if (cpRevealBusy) return;   // ignore the reveal's own re-pin scrolls (prevents the accordion-flash / scroll-nudge)
        if (cpSpyRaf) return;
        cpSpyRaf = requestAnimationFrame(function () { cpSpyRaf = 0; cpScrollSpy(); cpFitConsoleTail(); cpHeadFade(); });
      }, { passive: true });
    }

    function cpSyncConsoleClass() {
      // The floating SHELL (top bar + sidebar + content panel) is active on ANY reseller app
      // page that carries the left-nav folder sidebar — the console MENU and the list pages
      // (Groups/Users/etc.) alike — so the shell persists as you navigate and only the central
      // panel content swaps. (Class name is historical; it now gates the whole shell.) Absent on
      // login/recovery/logout pages (no leftNavForm), so those stay untouched.
      var active = !!document.querySelector('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen');
      document.documentElement.classList.toggle("cp-console-active", active);
      if (active) {
        // Blank stray "-" placeholder text in the legacy header (empty level slot).
        // It's a lone "-" text node sharing a cell with whitespace, so target the node directly.
        var hdr = document.querySelector("body > table:first-of-type");
        if (hdr) {
          var w = document.createTreeWalker(hdr, NodeFilter.SHOW_TEXT, null);
          var tn;
          while ((tn = w.nextNode())) {
            if ((tn.textContent || "").trim() === "-") tn.textContent = "";
          }
        }
        // Inject/refresh the CommPilot top-bar overlay (brand LEFT + welcome RIGHT).
        // A fixed layer tracks the floating bar exactly; the legacy welcome span is
        // hidden via CSS and its text is mirrored into .cp-welcome on the right.
        var topbar = document.querySelector(".cp-topbar");
        if (!topbar) {
          topbar = document.createElement("div");
          topbar.className = "cp-topbar";
          var brand = document.createElement("div");
          brand.className = "cp-brand";
          brand.innerHTML = '<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 94,86 6,86" fill="#6E4C96"></polygon><polygon points="50,40 72,84 28,84" fill="#E89150"></polygon></svg><span class="cp-brand-name">Comm<b>Pilot</b></span>';
          var welcome = document.createElement("div");
          welcome.className = "cp-welcome";
          topbar.appendChild(brand);
          topbar.appendChild(welcome);
          document.body.appendChild(topbar);
        }
        var welSrc = document.querySelector(".headerBarWelcome");
        var welEl = topbar.querySelector(".cp-welcome");
        if (welEl && welSrc) welEl.textContent = (welSrc.textContent || "").replace(/\s+/g, " ").trim();
      } else {
        var tb = document.querySelector(".cp-topbar");
        if (tb && tb.parentNode) tb.parentNode.removeChild(tb);
      }
    }

    function cpAutoConsole() {
      cpSyncConsoleClass();
      if (document.querySelector(".cp-console")) return;                 // already showing the console
      if (!document.querySelector('a.leftnavfolder, a.leftnavfolderopen')) return;  // not a reseller folder page
      var cell = document.querySelector('td[width="82%"]');
      // Build ONLY when the content cell is a folder MENU (has navMenu options), never a list/leaf
      // destination. Check CONTENT, not location.pathname — pjax fires cp:reskin BEFORE it updates the
      // URL, so location.pathname is stale (still the previous page) at this moment.
      if (!cell || !cell.querySelector('a.navMenuItem')) {
        // List/leaf SUB-PAGE (not a folder menu): collapse any sidebar submenu left open from the
        // console so the expanded accordion doesn't persist onto the list page.
        document.querySelectorAll('form[name="leftNavForm"] td.cp-grp-open').forEach(function (td) { td.classList.remove("cp-grp-open"); });
        // On a FULL-LOAD sub-page (reload/recovery) skin.js built the crumb without the mega menu — attach it.
        cpDecorateCurrentCrumbPill();
        // REDESIGNED SEARCH GRID (flagged): a page.jsp-paginated search LIST (has #searchTable) → preload-all
        // grid instead of the in-place legacy table. skin.js skips its list skinning while html.cp-grid-on is set.
        if (cpNewSearchOn() && document.getElementById("searchTable")) { cpBuildSearchGrid(); return; }
        document.documentElement.classList.remove("cp-grid-on");
        return;
      }
      document.documentElement.classList.remove("cp-grid-on");
      cpBuildConsole();   // no-ops at non-reseller levels (the reseller-only gate returns early there)
    }

    // Build console on reskin (runs after every pjax swap)
    document.addEventListener("cp:reskin", cpAutoConsole);
    // Also build after the zero-nav login morph (it dispatches cp:morphed, not cp:reskin)
    document.addEventListener("cp:morphed", cpAutoConsole);
    // Initial build for pages that already have folders (refresh / recovery land)
    cpAutoConsole();

    // Capture-phase sidebar folder click → scroll to section while console is showing
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a.leftnavfolder, a.leftnavfolderopen');
      if (!a) return;
      var fid = a.getAttribute('data-cp-folder');
      if (!fid) return;
      if (!document.querySelector('.cp-console')) {
        // Not on the console (e.g. a Groups/Users list): let the native nav take us to the
        // reseller menu, but remember which folder was clicked so the console jumps to THAT
        // section instead of defaulting to the top (Profile).
        cpPendingFolder = fid;
        return;
      }
      var sec = document.querySelector('.cp-console-section[data-cp-folder="' + fid + '"]');
      if (!sec) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Suppress the scroll-spy for the smooth-scroll's duration so it doesn't flip the accordion
      // back to the lagging top-of-viewport folder mid-scroll (the sidebar "jump" on folder click).
      cpSpySuppressUntil = Date.now() + 700;
      cpFitConsoleTail();   // ensure trailing space first, so the target (esp. the last section) can reach the top
      // Scroll the section flush to the top of the console MANUALLY rather than scrollIntoView():
      // the section headers are position:sticky, and scrollIntoView over-scrolls to clear the sticky
      // header, leaving a gap above the section (the "extra space" bug). Aligning the section's top to
      // the console's top by hand lands it flush, exactly like a manual scroll does.
      var cons = document.querySelector('.cp-console');
      if (cons) {
        var target = cons.scrollTop + (sec.getBoundingClientRect().top - cons.getBoundingClientRect().top);
        cons.scrollTo({ top: target, behavior: 'smooth' });
      }
      cpHighlightFolder(fid);   // instant highlight; spy stays suppressed until the scroll settles
    }, true);
  }
})();
