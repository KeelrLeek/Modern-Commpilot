(function () {
  // Version stamp — logged on EVERY page load (login included) so a reload is trivially verifiable
  // in the console (read for "[pjax] v…"). Bump per build alongside manifest.json so a stale/failed
  // reload is caught immediately instead of chasing a phantom bug. Keep in sync with manifest version.
  var CP_PJAX_VERSION = "0.2.59";
  try { console.log("[pjax] v" + CP_PJAX_VERSION + " loaded"); } catch (e) {}

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
          /\/commpilot\/Reseller\/[A-Za-z]+\/(index\.jsp)?$/.test(u) ||
          // SP- and GROUP-scoped list landings (e.g. SP "Groups" → /ServiceProvider/Members/, SP "Users" →
          // /ServiceProvider/Users/; GROUP "Users" → /Group/Members/, group Departments/Schedules/etc.).
          // These serve real content to a plain background fetch (verified: SP Members + Group Members both
          // return the full list, not a shell), so they ride the SAME fetch path as reseller lists — no iframe
          // (cpNeedsFrame stays false). Only list LANDINGS match (one section segment + optional index.jsp);
          // deeper /Modify/ edit pages don't.
          /\/commpilot\/ServiceProvider\/[A-Za-z]+\/(index\.jsp)?$/.test(u) ||
          /\/commpilot\/Group\/[A-Za-z]+\/(index\.jsp)?$/.test(u) ||
          /\/ServiceProviders\/Modify\//.test(u) ||
          // GROUP entry (clicking a group row). The URL depends on which list you came from: the SP Groups
          // list → /ServiceProvider/Members/Modify/, the reseller Groups list → /Reseller/Groups/Modify/.
          /\/(?:ServiceProvider\/Members|Reseller\/Groups)\/Modify\//.test(u) ||
          // USER entry (clicking a user row in a group's Users list) → /Group/Members/Modify/.
          /\/Group\/Members\/Modify\//.test(u) ||
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
          if (html.indexOf("Please login again") !== -1 || html.indexOf("not authorized to access the system") !== -1)
            return { auth: false };
          var doc = new DOMParser().parseFromString(html, "text/html");
          if (doc.querySelector('td[width="82%"]')) return { doc: doc, html: html };
          var stub = cpExtractStub(doc);
          if (stub && stub.target && depth < 4) {
            console.log("[pjax] following stub ->", stub.target);
            return cpFollow(stub.target, stub.data, stub.token, depth + 1);
          }
          return { doc: doc, html: html };
        });
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
        var settled = false;
        function done(val) {
          if (settled) return;
          settled = true;
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
    function cpAggBegin(anchorFolder, anchorHtml) {
      cpAggEnd();
      cpAggActive = true;
      cpAggAnchorFolder = anchorFolder || null;
      cpAggCache = {};
      if (anchorFolder && anchorHtml != null) cpAggCache[anchorFolder] = anchorHtml;
      var t = document.getElementsByName("formtokenserial")[0];
      cpAggToken = t ? t.value : null;
    }
    function cpAggEnd() {
      cpAggActive = false; cpAggToken = null; cpAggAnchorFolder = null; cpAggCache = null;
    }
    function cpAggPrefetch(folders) {
      var seq = Promise.resolve();
      folders.forEach(function (f) {
        if (f.folder === cpAggAnchorFolder) return;   // anchor reuses its captured menu
        seq = seq.then(function () {
          if (cpSectionAborted) { cpAggCache[f.folder] = null; return; }
          var tokEl = document.getElementsByName("formtokenserial")[0];
          var tok = (tokEl ? tokEl.value : null) || cpAggToken;
          return cpFollowFrame("/commpilot/Common/folder_contents.jsp", { folder: f.folder, menuId: f.menuId || "2" }, tok, 0)
            .then(function (res) {
              if (!res || res.auth === false || !res.doc) { cpAggCache[f.folder] = null; return; }
              var nt = res.doc.getElementsByName("formtokenserial")[0];
              if (nt && nt.value) { cpAggToken = nt.value; var ts = document.getElementsByName("formtokenserial"); for (var i = 0; i < ts.length; i++) ts[i].value = nt.value; }
              var td = res.doc.querySelector('td[width="82%"]');
              var n = td ? td.querySelectorAll('a.navMenuItem').length : 0;
              cpAggCache[f.folder] = (td && n > 0) ? td.innerHTML : null;
            })
            .catch(function () { cpAggCache[f.folder] = null; });
        });
      });
      return seq;
    }
    function cpAggNavigate(folder) {
      // Reveal-time read: return the pre-fetched menu HTML (null if that folder shelled). No live load —
      // the loads already happened against the intact page in cpAggPrefetch.
      return Promise.resolve(cpAggCache ? cpAggCache[folder] : null);
    }

    cpHook = function (url, params) {
      try {
        if (isPjaxUrl(url)) {
          var mySeq = ++cpSeq;
          try { cpLastNav = { url: url, params: params || {} }; } catch (e) {}
          // Remember the SP entry (Modify nav) — recorded for reload/replay + future Group/User work.
          try { if (/\/ServiceProviders\/Modify\//.test(url)) cpSpEntry = { url: url, params: params || {} }; } catch (e) {}
          try { if (url.indexOf("/Common/page.jsp") === -1 && url.indexOf("/Common/sort.jsp") === -1) { var _nav = { url: url, params: params || {} }; sessionStorage.setItem("cp-last-nav", JSON.stringify(_nav)); window.postMessage({ __cpRecoverNav: _nav }, location.origin); } } catch (e) {}
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var cpLoader = cpNeedsFrame(url, params) ? cpFollowFrame : cpFollow;
          console.log("[pjax]", cpLoader === cpFollowFrame ? "iframe-loading" : "fetching", url);
          cpLoader(url, params, liveTokEl ? liveTokEl.value : null, 0)
            .then(function (res) {
              if (mySeq !== cpSeq) {
                console.log("[pjax] superseded — dropping stale swap");
                return;
              }
              if (!res || res.auth === false || !res.doc.querySelector('td[width="82%"]')) {
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
                  // Append the current entity (span.headerAuthLevel — e.g. a user id) as the current pill.
                  var cLen = ctrail.length, cEnt = doc.querySelector("span.headerAuthLevel");
                  if (cEnt) { var et = (cEnt.textContent || "").replace(/^\s*:\s*/, "").trim(); if (et && ctrail[ctrail.length - 1] !== et) ctrail.push(et); }
                  if (ctrail.length && titleTable && titleTable.parentNode) {
                    titleTable.parentNode.insertBefore(cpBuildPillCrumb(ctrail, ctrail.length > cLen), titleTable);
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
      // Fall back to the persisted cp-last-nav (sessionStorage) before the reseller-home default: after a
      // reload-button recovery the page is fresh, so the in-memory cpLastNav is null even though we ARE deep
      // in an SP/group/user — without this, F5 right after the reload button jumps all the way to reseller.
      var nav = cpLastNav;
      if (!nav) { try { nav = JSON.parse(sessionStorage.getItem("cp-last-nav") || "null"); } catch (e) {} }
      if (!nav || !nav.url) nav = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
      console.log("[pjax] reload intercepted → replay", nav.url);
      try { window.redirectPost(nav.url, nav.params || {}); } catch (err) { console.warn("[pjax] reload replay failed", err); }
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
    // Build the PILL TRAIL breadcrumb (Option B) from an array of segment texts. Shared by cpBuildConsole
    // (console pages) and cpHook's restore (list/leaf pjax swaps). Ancestors are clickable via cpCrumbNav;
    // the current/last level is a static pill.
    function cpBuildPillCrumb(trail, idLast) {
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
        var pill = document.createElement(isCur ? "span" : "a");
        // The last segment is the current pill; if it's the entity ID (idLast) it gets .cp-bc-id so the
        // CSS preserves its case (an id like RSG171001@phonenetwork.net, not an uppercased level name).
        pill.className = isCur ? (idLast ? "cp-bc-cur cp-bc-id" : "cp-bc-cur") : "cp-bc-seg";
        pill.textContent = seg;
        if (isCur) {
          pill.setAttribute("aria-current", "page");
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
      return crumb;
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
      document.querySelectorAll("a.headerAuthLevelLink").forEach(function (a) { pushSeg((a.textContent || "").trim()); });
      if (!trail.length) {
        var existingCrumb = document.querySelector(".cp-breadcrumb");
        if (existingCrumb) existingCrumb.querySelectorAll(".cp-bc-seg, .cp-bc-cur, a").forEach(function (a) { pushSeg((a.textContent || "").trim()); });
      }
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
      var crumb = cpBuildPillCrumb(trail, trail.length > _tl);   // route · clickable ancestors · arrows · current
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
        cpAggPrefetch(folders).then(function () {
          startReveal();   // anchor already revealed (skipped as loaded); the rest cascade in from cache
        });
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
        item.textContent = title;
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
        var top = head.getBoundingClientRect().top - consTop;
        var H = head.offsetHeight || 50;
        var p = top < 0 ? Math.max(0, Math.min(1, 1 + top / (H * 0.30))) : 1;
        inner.style.opacity = p;
        inner.style.transform = top < 0 ? ("scale(" + (0.9 + 0.1 * p).toFixed(3) + ")") : "";
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
        // List/leaf page (not a folder menu): collapse any sidebar submenu left open from the
        // console so the expanded accordion doesn't persist onto the list page.
        document.querySelectorAll('form[name="leftNavForm"] td.cp-grp-open').forEach(function (td) { td.classList.remove("cp-grp-open"); });
        return;
      }
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
