(function () {
  // The hidden POST transport loads CommPilot in sandboxed frames. PJAX owns
  // only the top-level page; running here would rewrite the frame's joint
  // history state and can turn Back into a full document navigation.
  if (window !== window.top) return;
  // Version stamp — logged on EVERY page load (login included) so a reload is trivially verifiable
  // in the console (read for "[pjax] v…"). Bump per build alongside manifest.json so a stale/failed
  // reload is caught immediately instead of chasing a phantom bug. Keep in sync with manifest version.
  var CP_PJAX_VERSION = "0.3.42-native";

  // CP_DEBUG gates the ROUTINE per-nav [pjax] logs (fetching/response-200/re-executed/reskin/etc.) so a HEALTHY
  // navigation leaves the console near-silent. Flip on with localStorage.cpDebug="1" (read once at load). Every
  // console.warn/console.error stays ALWAYS-ON — real failures still surface. cpDbg() replaces the gated logs.
  var CP_DEBUG = false;
  try { CP_DEBUG = localStorage.getItem("cpDebug") === "1"; } catch (e) {}
  function cpDbg() { if (CP_DEBUG) { try { console.log.apply(console, arguments); } catch (e) {} } }

  // Rolling coalescer for the pjax transport WARN lines: a single degraded nav fans out into dozens of section/
  // leaf/grid-harvest fetches, each logging its 500/bounce/FAILED with identical text within ~1s → an avalanche.
  // Coalesce by (key): the first hit within a 1500ms window logs immediately; repeats are counted and a single
  // trailing "… (xN)" summary is emitted when the burst settles. Logging-only — never changes nav behavior.
  var cpCoMap = Object.create(null);
  function cpWarnCo(key, msg) {
    try {
      var now = (window.performance && performance.now) ? performance.now() : (+new Date());
      var e = cpCoMap[key];
      if (e && (now - e.last) < 1500) {
        e.count++; e.last = now;
        if (e.timer) clearTimeout(e.timer);
        e.timer = setTimeout(function () { if (e.count > 1) console.warn(msg + " (x" + e.count + ")"); cpCoMap[key] = null; }, 1600);
        return;
      }
      console.warn(msg);
      cpCoMap[key] = { count: 1, last: now, timer: setTimeout(function () { cpCoMap[key] = null; }, 1600) };
    } catch (x) { try { console.warn(msg); } catch (y) {} }
  }
  // Version stamp stays ALWAYS-ON: one line at load, and the reload-verification dance needs it visible to
  // confirm the on-disk build actually loaded (not a stale cached script). It never fires on a nav.
  try { console.log("[pjax] v" + CP_PJAX_VERSION + " loaded" + (CP_DEBUG ? " (debug)" : "")); } catch (e) {}

  // ── NO BACKGROUND PINGS — deliberate (0.2.282). Two keep-alive designs were tried and BOTH caused the very
  // idle logout they aimed to prevent (proven live 2026-07-02, controlled A/B on apps-sbx): a static styles.css
  // GET every 45s → logged out at ~20 min; a servlet/Login GET every 45s → logged out at ~26 min; the SAME
  // build/account/server with pings OFF idled 35 min and stayed logged in (as did the raw no-extension control,
  // 38+ min). Something server-side (session filter or LB) invalidates a session receiving bare background GETs.
  // DO NOT reintroduce a ping here. Idle resilience is handled by the transport fixes instead: the one-shot nav
  // retry (0.2.264), redirect:'manual' bounce classification (0.2.278), and the in-place token re-harvest on
  // auth-fail (0.2.279). See [[gotcha-idle-connection-drop-dead-click]].

  // Keep server-provided styling on fetched pages so PJAX does not change
  // the original CommPilot appearance.
  function cpStripInlineStyles(html) {
    // Keep CommPilot's own inline styling when a fetched page is swapped in.
    return String(html);
  }

  // Single-page sign-out: minimum time (ms) the "Signing out…" spinner stays up
  // before landing on the login, so a fast logout still reads as a smooth,
  // intentional moment instead of a flicker. See cpSignOutFetch / cpHook.
  var CP_LOGOUT_MIN_MS = 1400;

  try {
    var cpInitialPath = location.pathname;
    // A fresh reseller login lands on folder_contents.jsp by POST. Replaying
    // that URL without its folder selection bounces to Login on Back.
    var cpInitialNav = cpInitialPath === "/commpilot/Common/folder_contents.jsp" ?
      { url: cpInitialPath, params: { folder: "R0", menuId: "8" } } :
      cpInitialPath.indexOf("/commpilot/") === 0 && cpInitialPath.indexOf("/Login/") === -1 ?
      { url: cpInitialPath, params: {} } :
      { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
    history.replaceState({ cpNav: cpInitialNav }, "", location.href);
  } catch (e) {}

  var onLogin =
    location.pathname.indexOf("/Login/") !== -1 ||
    // A password field ALONE is not a login page — the admin Modify page has Reset-Password fields but is a real
    // in-app page (it carries the app content cell / nav). Only treat a password field as "login" when the app
    // chrome is ABSENT (a true login page has no content cell or nav menu). Otherwise the Modify page falsely set
    // onLogin → cp-pending-return → a spurious full-load + auto-return on its own form navigations.
    (!!document.querySelector('input[name="password"]') &&
     !document.querySelector('td[width="82%"], a.navMenuItem, .navOptions'));
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
  var cpDclSpin = false;   // true while cpListSearch's harvest re-dispatches DOMContentLoaded (see cpHook guard)
  var cpLastNav = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
  var cpPopReplaying = false;
  var cpPopScroll = null;
  var cpReexecutingScripts = false;
  var cpAutoReplaceUrl = null;
  var cpConfigFilesForwarded = false;
  var _orig = null;
  var cpHook = null;
  var cpSrcCollector = null;
  var cpExternalDclRestore = null;
  var cpSectionQueue = [];
  var cpSectionRunning = false;
  var cpSectionAborted = false;
  var cpConsoleObserver = null;
  var cpPeekObserver = null;
  var cpFrameSeq = 0;
  var cpSpEntry = null;
  // The list LANDING a Find/Find All search was launched from. After a search the address bar reads
  // /Common/findAll.jsp, against which a later RELATIVE redirectPost from the list (the Add/Import buttons'
  // "Add/index.jsp") would resolve to /Common/Add/index.jsp → 404. We resolve such relative navs against this
  // landing instead. Captured at search time (when location is still the real landing). See [[gotcha-relative-nav-after-search]].
  var cpSearchLanding = null;
  var cpSearchLandingNav = null;
  // The LIST a form page (Add/Import/Modify) was OPENED from — recorded at form-open time in cpHook, when
  // location is still the list. A form's action POSTs to the FORM endpoint but the server answers with the
  // LIST screen (no redirect stub), stranding the address bar on the form URL: the grid's next search then
  // POSTs to the form endpoint → 0 results forever (live: DeviceType Add 2026-07-03), and relative Add
  // buttons double up. Used to re-anchor the canonical URL when a submit's response renders list content.
  var cpFormOrigin = null;
  // The nav that last CHANGED the sidebar level (a res→SP/Group/User drill or an exit back up) — i.e. the
  // request that established the server's CURRENT target context. Persisted with cp-last-nav so recovery
  // paths can re-enter the entity before replaying an entity-scoped page: a recovery replay alone lands on
  // a context-reset session → "There is no target object to get viewable features" → 500s/logout (live
  // repro: F5 on an SP Schedules grid, 2026-07-04).
  var cpEntityEntry = null;
  // One-shot follow-up nav consumed after the NEXT successful swap — lets a caller chain "enter the entity,
  // THEN open the page" through pjax (auto-return after login uses it; see cpEntityEntry).
  var cpPendingNav = null;
  // The CURRENT entity id (e.g. a user id) for the breadcrumb's last pill. Captured from each pjax swap's
  // FETCHED doc (cpHook) because after the swap the live header keeps the PREVIOUS entity (it isn't swapped)
  // and the fresh content cell has none — so neither live source is reliable. null = no pjax swap yet this
  // page load (cpBuildConsole then reads the live header, which IS fresh on an initial/recovery load).
  var cpCurEntity = null;
  var cpAggActive = false;
  var cpAggGeneration = 0;
  var cpAggToken = null;
  var cpAggAnchorFolder = null;
  var cpAggCache = null;   // SP pre-fetch cache {folder: menuHtml|null}, filled before the page is wiped
  var cpAggReady = null;   // {folder: {promise, resolve}} — per-folder deferred so the reveal can await each
  var cpAggNavReady = null; // resolves after the entity context is restored, before a board link may navigate
  var cpAggPrefetchFailed = false;
  var cpBoardFailed = false;
  // sidebarSig -> { groups:[{label,items:[{name,url,params}]}] } of a level's pages, harvested once its console
  // is built; powers the breadcrumb current-pill MEGA menu. PERSISTED to sessionStorage so it survives a reload
  // — otherwise landing on a sub-page after reload/recovery (no console rebuilt) leaves the menu empty.
  var cpLevelPages = (function () { try { return JSON.parse(sessionStorage.getItem("cp-level-pages")) || {}; } catch (e) { return {}; } })();
  // Consecutive server-5xx streak across navs (reset on any successful swap). Two in a row on this
  // host almost always means the session is DEAD (once killed, it echoes 500s on every POST —
  // measured repeatedly 2026-07-07) — surface ONE "session expired" banner with a sign-in action
  // instead of stacking identical server-error banners.
  var cpErr5xxStreak = 0;
  // A rejected follow can replay page scripts that immediately try the same navigation again.
  // Once token recovery has failed, make a single sign-in transition instead of posting in a loop.
  var cpSessionRedirecting = false;
  // Client-only idle watchdog (ZERO network — keep-alive pings are proven session-killers on this
  // host, see [[gotcha-idle-connection-drop-dead-click]]; never reintroduce them). The sandbox
  // expires idle sessions around ~20 min (controlled measurement 2026-07-07: 24 idle minutes,
  // 0 requests sent, next click bounced to Login). Warn passively at 18 min so the sign-in prompt
  // isn't a surprise; the banner clears on the next successful swap.
  var cpLastSwapAt = Date.now();
  var CP_IDLE_WARN_MS = 18 * 60 * 1000;
  var cpCrumbDd = null;    // the live breadcrumb dropdown element + its teardown, if open.
  var cpGridState = null;  // the redesigned search GRID's live state (data/sort/page/cols), if active.
  // Count of token-bearing POSTs currently in flight (cpFollow / cpFollowFrame). The grid's broad search
  // rotates the single-use formtokenserial on EVERY page.jsp hop, so while any of these are outstanding the
  // live token is mid-rotation. A reload/nav that POSTs in that window sends a stale token → the server
  // bounces to Login ("session timeout"). The reload handler drains this to 0 before replaying. INCLUDES an
  // aborted-but-still-resolving prior search (abort stops the LOOP, not the in-flight fetch), which the old
  // single-_searchPromise wait missed.
  var cpInflightPosts = 0;
  var cpTokenDrainSeq = 0;
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
        s.addEventListener("load", function () { this._cpLoaded = true; }, { once: true });
        s.addEventListener("error", function () { this._cpLoaded = true; }, { once: true });
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
          try { fn.call(window, new Event("load")); } catch (e) { cpWarnCo("loadshim|" + String((e && e.message) || e), "[pjax] load shim err: " + String((e && e.message) || e)); }
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

  // Idle watchdog tick — PURELY CLIENT-SIDE (no network, ever; see cpLastSwapAt above). Past the
  // threshold, show one passive warning so the user expects the sign-in prompt; cleared on the next
  // successful swap.
  setInterval(function () {
    try {
      if (Date.now() - cpLastSwapAt < CP_IDLE_WARN_MS) return;
      if (document.getElementById("cp-idle-warn")) return;
      var bc = document.querySelector('td[width="82%"]');
      if (!bc || location.pathname.indexOf("/Login/") !== -1) return;
      var mins = Math.round((Date.now() - cpLastSwapAt) / 60000);
      var b = document.createElement("div");
      b.id = "cp-idle-warn";
      b.className = "cp-alert cp-alert-warning";
      b.innerHTML =
        '<div class="cp-alert-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>' +
        '<div class="cp-alert-content"><div class="cp-alert-title">Idle for ' + mins + ' minutes</div>' +
        '<div class="cp-alert-body">This system expires idle sessions after about 20 minutes — your next action may ask you to sign in again.</div></div>';
      bc.insertBefore(b, bc.firstChild);
    } catch (e) {}
  }, 60000);

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
      // CommPilot tabs can target a supported page with query flags. Match the
      // route itself while leaving the original URL intact for the POST.
      if (typeof u === "string") u = u.replace(/[?#].*$/, "");
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
          u.indexOf("/commpilot/Common/sort.jsp") !== -1 ||
          // Admins-style SERVER SEARCH: the page's doFind/doFindAll redirectPost to these. Pjax-handle them so the
          // search threads the rotating formtokenserial and swaps IN PLACE. Previously unlisted → cpHook native-
          // submitted → a FULL page reload per search (flicker + slower), and a full POST on a degraded token
          // bounced to /Login/. With them here, the grid rebuilds on cp:reskin and the harvest poll re-runs the
          // page's fill (find.jsp/findAll.jsp render their cells client-side, like the list landing).
          u.indexOf("/commpilot/Common/find.jsp") !== -1 ||
          u.indexOf("/commpilot/Common/findAll.jsp") !== -1 ||
          // Shared settings pages are linked from service provider and group
          // menus, but their endpoints live outside those level prefixes.
          /\/commpilot\/Common\/(?:DeviceProfileAuthPasswordRules|Password_Rules|PasscodeRules|SipAuthPasswordRules)\/index\.jsp$/.test(u) ||
          /\/commpilot\/Intercept\/index\.jsp$/.test(u) ||
          // Admin row DRILL-IN: the Administrators list row navigates via /Reseller/Admins/modify.jsp (a "set the
          // modify context, then redirect to .../Admins/Modify/" endpoint). Unlisted → cpHook native-submitted it
          // → a FULL page load on drill-in AND a native POST that degraded the single-use token → /Login/.
          // Pjax-handle it so cpFollow threads the rotating token and follows the stub to Modify/ in-shell.
          u.indexOf("/Admins/modify.jsp") !== -1 ||
          // SP-scoped ASSIGN pages live under the Operator scope (Assign Domains =
          // /Operator/ServiceProviders/AssignDomains/). Unlisted → the console card full-loaded AND every
          // search/move/OK posted natively. The page's search + pick-list moves ride the submit
          // interceptor once listed (the move buttons themselves are re-wired by the assign-picker click
          // handler below — their DCL wiring dies on an in-shell swap).
          u.indexOf("/Operator/ServiceProviders/AssignDomains/") !== -1 ||
          // Device-management IMPORT pages live under the Operator/System scope (e.g. Device Families' Import =
          // /Operator/System/DeviceFamilies/Import/index.jsp), NOT /Reseller/. Unlisted → the list's Import button
          // redirectPost'd there, cpHook saw a non-pjax url and NATIVE-navigated → a FULL page reload (legacy
          // styles/graphics re-fetched). Listing it routes the open through cpFollow so the upload form renders
          // in-shell. The import's multipart POST goes through cpSubmitImportUpload below, which follows the
          // servlet's response stub back into PJAX. Cancel posts to the already-matched /Reseller list.
          /\/commpilot\/Operator\/System\/[A-Za-z0-9_]+\/Import\/(index\.jsp)?$/.test(u) ||
          // Device-management DRILL-IN: clicking a reseller Tag Set opens its Modify sub-page (the tag-name/value
          // grid) at /Operator/System/DeviceTags/Modify/TagSet/index.jsp — same Operator/System scope as Import, so
          // unlisted meant cpHook native-navigated → a FULL page reload on drill-in (legacy styles/graphics
          // re-fetched). Listing it routes the drill through cpFollow so the sub-page (itself a searchable grid)
          // opens in-shell. Generic for any Operator/System <section>/Modify/… entry.
          /\/commpilot\/Operator\/System\/[A-Za-z0-9_]+\/Modify\//.test(u) ||
          // Device-management ADD forms (e.g. Identity/Device Profile Type Add =
          // /Operator/System/DeviceType/Add/index.jsp). Unlisted → the list's Add button redirectPost'd there,
          // cpHook native-navigated → a FULL page reload AND the OK save (posts to self = …/Add/index.jsp) fell
          // through the submit interceptor to a native POST. Listing it routes the open + the OK save through
          // cpFollow in-shell (server still validates; blank submit → "Failed to add"). Cancel is type=button,
          // DCL-wired → won't survive the swap → routed to the /Reseller list by the Cancel click handler below.
          // Scoped to DeviceType so it can't disturb the committed Tag Sets forms in the same Operator/System scope.
          /\/commpilot\/Operator\/System\/DeviceType\/Add\/(index\.jsp)?$/.test(u) ||
          // The DeviceType MODIFY form (the Modify/ mini console's "Profile" item). Unlisted → that click
          // native-navigated (full reload, observed 2026-07-04) and the OK/Apply/Delete self-POST would fall
          // through the submit interceptor the same way the Add form's did.
          /\/commpilot\/Operator\/System\/DeviceType\/Profile\/(index\.jsp)?$/.test(u) ||
          // Schedule EVENT pages (behind the Schedule Modify events grid): the grid's Add button
          // redirectPosts to …/Schedules/Events/Add/ and an event row drills to …/Schedules/Events/Modify/
          // — THREE section segments, so the 1-2 segment SP/Group patterns above miss them → cpHook
          // native-navigated (FULL reload, observed 2026-07-06). Listed, the Add form's modal-fail fallback
          // and the row drill both swap in-shell, and the form's ok/cancel self-POSTs ride cpFollow.
          /\/commpilot\/(?:ServiceProvider|Group)\/Schedules\/Events\/(?:Add|Modify)\/(index\.jsp)?$/.test(u) ||
          // CommPilot has deeper settings trees under each level. Keep those
          // pages in the shell, including Operator pages, while leaving Login,
          // Common utilities, and servlet/download endpoints on their existing
          // dedicated paths. A content-less response still falls back safely.
          (/^\/commpilot\/(?:Reseller|ServiceProvider|Group|User)(?:\/[A-Za-z0-9_-]+){3,8}\/(?:[A-Za-z0-9_-]+\.jsp)?(?:\?[^#]*)?$/.test(u) &&
            !/\/Logout(?:\/|$)/i.test(u)) ||
          (/^\/commpilot\/Operator(?:\/[A-Za-z0-9_-]+){1,8}\/(?:[A-Za-z0-9_-]+\.jsp)?(?:\?[^#]*)?$/.test(u) &&
            !/\/Logout(?:\/|$)/i.test(u)))
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
      if (p && Array.isArray(p.__cpFormEntries)) {
        var tokenPlaced = false;
        p.__cpFormEntries.forEach(function (entry) {
          if (entry[0] === 'formtokenserial') { body.append(entry[0], token || entry[1]); tokenPlaced = true; }
          else body.append(entry[0], entry[1]);
        });
        if (token && !tokenPlaced) body.append('formtokenserial', token);
      } else {
        for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) body.append(k, p[k]);
        if (token) body.append('formtokenserial', token);
      }
      cpInflightPosts++;   // mark a token-bearing POST in flight (drained by the reload handler)
      var _settled = false, _done = function () { if (_settled) return; _settled = true; cpInflightPosts = Math.max(0, cpInflightPosts - 1); };
      // redirect:"manual" — a server 3xx is this app's LOGIN/SESSION BOUNCE (the server hard-codes an
      // http:// Login redirect). Under the default redirect:"follow" the browser tries to follow that hop,
      // block-all-mixed-content (page CSP) blocks the http:// target, and fetch REJECTS with
      // "TypeError: Failed to fetch" — INDISTINGUISHABLE from a dropped socket — while ALSO logging a
      // connect-src CSP violation (the console noise). With redirect:"manual" the bounce comes back as a clean
      // opaqueredirect Response (status 0, type "opaqueredirect"): no attempted http hop → no CSP violation, no
      // false network error. We route it as {auth:false} so cpHook's fresh-token re-attempt / recovery runs
      // instead of a silent dead click. Normal navs are 200 with content — this POST-based app never uses a 3xx
      // for real navigation. See [[gotcha-idle-connection-drop-dead-click]] / [[gotcha-csp-inline-style-attr-blocked]].
      return fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "same-origin",
        redirect: "manual"
      })
        .then(function (r) {
          if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
            cpWarnCo("bounce|" + u, "[pjax] session bounce (server redirect) on " + u + " (hop " + depth + ") — auth-fail, no socket drop");
            return { auth: false };
          }
          if (r.status >= 500) {
            // Server error — return a DISTINCT failure and DO NOT parse/follow the error page's embedded
            // redirect stub. The old flow hopped the stub back into the failing endpoint (up to depth 4 →
            // 5 token-bearing POSTs into a 500ing page), which is how one broken menu item (DeviceInventory
            // Find-All, Xsi at reseller) escalated a single 500 into a KILLED SESSION → logout (live
            // 2026-07-02). Callers route {err} to an in-place notice / grid error state — no more requests.
            cpWarnCo("resp|" + u + "|" + r.status, "[pjax] response " + r.status + " " + u + " (hop " + depth + ") — aborting (no stub-follow on a server error)");
            return { err: r.status };
          }
          cpDbg("[pjax] response", r.status, r.url, "(hop " + depth + ")");
          return r.text().then(function (html) {
            // Personal Assistant's Add saves the criterion but answers with a
            // tiny script calling top.location.replace('../'). It has no
            // content cell or redirectPost stub. Read the owner list and
            // confirm the new row instead of replaying the save or opening Login.
            if ((!html || /top\.location\.replace\(\s*["']\.\.\/["']\s*\)/.test(html)) &&
                /^\/commpilot\/User\/PersonalAssistant\/Add\/index\.jsp$/.test(new URL(u, location.href).pathname) &&
                p && p.criteriaName && p.ok != null) {
              return cpFollow('/commpilot/User/PersonalAssistant/', {}, token, depth + 1).then(function (listResult) {
                var cell = listResult && listResult.doc &&
                  listResult.doc.querySelector('td[width="82%"]');
                if (cell && (cell.textContent || '').indexOf(String(p.criteriaName)) !== -1)
                  return listResult;
                return { unverifiedSave: 'CommPilot redirected after saving, but the new Personal Assistant rule could not be verified. Check the list before trying again.' };
              });
            }
            // Delete succeeds, then this controller tries to render the now
            // missing criterion and paints an "Invalid selective criteria name"
            // error. Confirm absence on the parent list before swapping it.
            if (/^\/commpilot\/User\/PersonalAssistant\/Modify\/index\.jsp$/.test(new URL(u, location.href).pathname) &&
                p && p.delete != null && (p.criteriaName || p.key || p.P_key)) {
              var deletedCriterion = String(p.criteriaName || p.key || p.P_key);
              return cpFollow('/commpilot/User/PersonalAssistant/', {}, token, depth + 1).then(function (listResult) {
                var cell = listResult && listResult.doc &&
                  listResult.doc.querySelector('td[width="82%"]');
                if (cell && (cell.textContent || '').indexOf(deletedCriterion) === -1)
                  return listResult;
                return { unverifiedSave: 'CommPilot returned an error after Delete, and the Personal Assistant rule could not be verified as removed. Check the list before trying again.' };
              });
            }
            if (html.indexOf("Please login again") !== -1 || html.indexOf("not authorized to access the system") !== -1) {
              cpWarnCo("authfail|" + u, "[pjax] AUTH-FAIL response from " + u + " (hop " + depth + ")");
              return { auth: false };
            }
            html = cpStripInlineStyles(html);   // drop nonce-mismatched legacy inline styles (blocked anyway) → no CSP noise
            var doc = new DOMParser().parseFromString(html, "text/html");
            if (doc.querySelector('td[width="82%"]')) return { doc: doc, html: html };
            var stub = cpExtractStub(doc);
            if (stub && stub.target && depth < 4) {
              // Resolve a RELATIVE stub target against the REQUEST url, not the document. In the legacy
              // full-page flow the stub document's location IS the POSTed url, so its redirectPost relatives
              // resolve against it — fetch() instead resolves against OUR page. Live 2026-07-06: a successful
              // Events/Add answers a stub → "../../Modify/index.jsp"; resolved against the hosting Schedule
              // Modify page that hit /ServiceProvider/Modify/ → 404 → the post-add refresh fell to a full nav.
              var st = stub.target;
              // Scheduled Reports Search answers with "\u002Findex.jsp" (an absolute /index.jsp).
              // That root endpoint returns 403; its list handler lives under this folder.
              if (st === "/index.jsp" &&
                  /^\/commpilot\/Group\/CCScheduledReports\/(?:index\.jsp)?$/.test(new URL(u, location.href).pathname))
                st = "/commpilot/Group/CCScheduledReports/index.jsp";
              try { st = new URL(st, new URL(u, location.href)).pathname; } catch (e) {}
              cpDbg("[pjax] following stub ->", st);
              return cpFollow(st, stub.data, stub.token, depth + 1);
            }
            return { doc: doc, html: html };
          });
        })
        .then(function (v) { _done(); return v; }, function (e) { _done(); throw e; });
    }

    // Harvest a FRESH valid app token in-place (the one GET-allowed, session-aware endpoint) — mirrors
    // stubguard's cpHarvestOnce trust rule EXACTLY: trust the token ONLY when servlet/Login hands back an
    // app redirect (redirectPost -> folder_contents), never the login form's own token. Resolves null when
    // the session is genuinely dead (bounce/opaqueredirect/no-stub) → caller opens sign-in once.
    // redirect:"manual" so a dead-session http:// Login bounce resolves as opaqueredirect (null) with NO
    // connect-src violation. Used by cpHook to recover a still-alive-but-token-stale nav in place instead of
    // hard-logging-out. See [[gotcha-idle-connection-drop-dead-click]].
    function cpHarvestFreshToken() {
      return fetch("/commpilot/servlet/Login", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual" })
        .then(function (r) {
          if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) return null;
          return r.text();
        })
        .then(function (html) {
          if (!html) return null;
          var stub = cpExtractStub(new DOMParser().parseFromString(cpStripInlineStyles(html), "text/html"));
          return (stub && stub.target && stub.target.indexOf("folder_contents") !== -1 && stub.token) ? stub.token : null;
        })
        .catch(function () { return null; });
    }

    // Iframe transport. At Service-Provider / Group / User levels, folder_contents.jsp returns a
    // content-less SHELL to an out-of-band fetch (XHR) but real CONTENT to a navigation. A hidden
    // sandboxed iframe IS a navigation, so it retrieves the real menu with no top-level nav/flash.
    // sandbox="allow-same-origin" (NO allow-scripts) keeps the doc readable AND neutralises the
    // page's frame-buster (which otherwise drives top.location back out). Mirrors cpFollow's
    // {doc,html}|{auth:false} contract incl. redirect-stub following (the SP "Modify" entry →
    // folder_contents 2-step), so cpHook's swap logic is identical regardless of transport.
    function cpFollowFrame(url, params, token, depth, timeoutMs) {
      return new Promise(function (resolve) {
        var ifr;
        function newFrame() {
          ifr = document.createElement("iframe");
          ifr.name = "cpFrame" + (++cpFrameSeq);
          ifr.setAttribute("sandbox", "allow-same-origin");
          ifr.style.cssText = "position:absolute;width:10px;height:10px;border:0;left:-9999px;top:-9999px";
          document.body.appendChild(ifr);
        }
        newFrame();
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
          if (p && Array.isArray(p.__cpFormEntries)) {
            var tokenPlaced = false;
            p.__cpFormEntries.forEach(function (entry) {
              if (entry[0] === 'formtokenserial') { add(entry[0], tok || entry[1]); tokenPlaced = true; }
              else add(entry[0], entry[1]);
            });
            if (tok && !tokenPlaced) add('formtokenserial', tok);
          } else {
            for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) add(k, p[k]);
            if (tok) add('formtokenserial', tok);
          }
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
            html = cpStripInlineStyles(html);
            var fdoc = new DOMParser().parseFromString(html, "text/html");
            if (fdoc.querySelector('td[width="82%"]')) { done({ doc: fdoc, html: html }); return; }
            var stub = cpExtractStub(fdoc);
            if (stub && stub.target && d < 4) {
              cpDbg("[pjax] frame stub ->", stub.target);
              // Each POST is the first navigation of a fresh frame. Reusing a
              // frame for the redirect chain adds joint session-history entries.
              // Those entries can intercept Back and discard the Forward page.
              try { ifr.remove(); } catch (e) {}
              newFrame();
              post(stub.target, stub.data, stub.token, d + 1);
              return;
            }
            done({ doc: fdoc, html: html });
          };
          f.submit();
        }
        post(url, params || {}, token, depth || 0);
        setTimeout(function () { done({ auth: false }); }, timeoutMs || 8000);
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
      cpAggPrefetchFailed = false;
      cpBoardFailed = false;
      cpAggNavReady = cpDefer();
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
    function cpAggEnd(readyForNavigation) {
      cpAggGeneration++;
      if (cpAggActive && !readyForNavigation && document.querySelector(".cp-console")) {
        cpBoardFailed = true;
        cpShowBoardFailure();
      }
      if (cpAggNavReady) {
        try { cpAggNavReady.resolve(!!readyForNavigation); } catch (e) {}
      }
      if (cpAggReady) {
        for (var pendingFolder in cpAggReady) {
          if (Object.prototype.hasOwnProperty.call(cpAggReady, pendingFolder))
            try { cpAggReady[pendingFolder].resolve(null); } catch (e) {}
        }
      }
      cpAggActive = false; cpAggToken = null; cpAggAnchorFolder = null; cpAggCache = null; cpAggReady = null; cpAggNavReady = null;
    }
    function cpShowBoardFailure() {
      var board = document.querySelector(".cp-console");
      if (!board || board.querySelector(".cp-console-error")) return;
      var notice = document.createElement("div");
      notice.className = "cp-console-error";
      notice.setAttribute("role", "alert");
      var message = document.createElement("span");
      message.textContent = "CommPilot could not finish loading this menu. Retry before opening an option.";
      var retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry menu";
      retry.addEventListener("click", function () {
        if (cpEntityEntry && cpEntityEntry.url) cpHook(cpEntityEntry.url, cpEntityEntry.params || {});
        else location.reload();
      });
      notice.appendChild(message);
      notice.appendChild(retry);
      board.insertBefore(notice, board.firstChild);
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
      var generation = cpAggGeneration;
      var seq = Promise.resolve();
      var failed = false;
      folders.forEach(function (f) {
        if (f.folder === cpAggAnchorFolder) return;   // anchor reuses its captured menu
        var deferred = cpAggReady[f.folder];           // capture THIS build's deferred (survives a cpAggEnd swap)
        seq = seq.then(function () {
          var settle = function (html) { if (cpAggCache) cpAggCache[f.folder] = html; deferred.resolve(html); };
          if (failed || cpSectionAborted || generation !== cpAggGeneration || !cpAggActive) { settle(null); return; }
          var tokEl = document.getElementsByName("formtokenserial")[0];
          var tok = (tokEl ? tokEl.value : null) || cpAggToken;
          return cpFollowFrame("/commpilot/Common/folder_contents.jsp", { folder: f.folder, menuId: f.menuId || "2" }, tok, 0, 20000)
            .then(function (res) {
              if (res && res.doc) {
                var nt = res.doc.getElementsByName("formtokenserial")[0];
                if (nt && nt.value) {
                  if (generation === cpAggGeneration) cpAggToken = nt.value;
                  var ts = document.getElementsByName("formtokenserial");
                  for (var i = 0; i < ts.length; i++) ts[i].value = nt.value;
                }
              }
              if (generation !== cpAggGeneration || !cpAggActive) { deferred.resolve(null); return; }
              if (!res || res.auth === false || !res.doc) {
                failed = true;
                cpAggPrefetchFailed = true;
                settle(null);
                return;
              }
              var td = res.doc.querySelector('td[width="82%"]');
              var n = td ? td.querySelectorAll('a.navMenuItem').length : 0;
              if (!td || n === 0) { failed = true; cpAggPrefetchFailed = true; }
              settle((td && n > 0) ? td.innerHTML : null);
            })
            .catch(function () { failed = true; cpAggPrefetchFailed = true; settle(null); });
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
    // Legacy "this list is empty" marker — BroadSoft renders a single <td>No Entries Present</td> (anchored, not a
    // substring of a data cell) ONLY when the server returns zero rows; a populated list has data rows instead. Used
    // by the client-fill harvest to tell "legitimately empty" from "async fill still pending" (so it stops instead
    // of spinning 60 ticks re-dispatching DOMContentLoaded). See [[gotcha-empty-list-harvest-spin]].
    function cpSearchHasEmptyMarker(doc) {
      var tds = doc.querySelectorAll("td");
      for (var i = 0; i < tds.length; i++) {
        if (/^\s*No Entries Present\.?\s*$/i.test(tds[i].textContent || "")) return true;
      }
      return false;
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
        // Link-less list rows (e.g. Call Recording Platforms): cells are plain <td> TEXT with spacer <td>s
        // between columns and NO a.tableLink — read the row's non-empty <td> texts in order instead, so the
        // list is harvested instead of skipped (the "0 results" bug). Drill (if any) still comes from the
        // row's redirectPost below; System-level read-only rows simply have none.
        if (!cells.length) {
          cells = [].map.call(tr.children, function (td) {
            if (td.tagName !== "TD") return "";
            var t = (td.textContent || "").replace(/\s+/g, " ").trim();
            // Boolean columns (e.g. DeviceType "Is Obsolete") render a checkmark IMAGE with no text —
            // same ✓ marker as the a.tableLink path above, or the flag silently drops from the grid.
            if (!t && td.querySelector("img")) t = "✓";
            return t;
          }).filter(function (t) { return t; });
        }
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
      var tokEl = document.getElementsByName("formtokenserial")[0];
      var tok = tokEl ? tokEl.value : null;

      var descLive = cpSearchDescriptor(document);

      // Admins-style (no #searchTable): the list is rendered CLIENT-SIDE from encoded data in the page scripts by
      // a fill gated on DOMContentLoaded. A pjax body-swap never re-fires DOMContentLoaded, and pjax's DCL shim
      // misses this late registration, so on IN-APP nav the rows are NEVER rendered — nothing to harvest, and a
      // background fetch is equally empty (the fill never runs in a DOMParser'd doc). Fix (validated live):
      // re-dispatch DOMContentLoaded to run the page's OWN fill, then POLL the (hidden) markup until the rows are
      // populated, harvest, and filter CLIENT-SIDE. criteria[0].key = column index ("0"/"1"/"2" = legacy findKey
      // option values); op "1"/"2"/"4" = Starts With / Contains / Equal To (findOp option values).
      if (!opts.ctx && !document.getElementById("searchTable") && descLive) {
        var aFilter = function (all) {
          if (!(criteria && criteria.length && criteria[0].value != null && criteria[0].value !== "")) return all;
          var colIdx = parseInt(criteria[0].key, 10); if (isNaN(colIdx)) colIdx = 0;
          var op = String(criteria[0].op || "1"), needle = String(criteria[0].value).toLowerCase();
          return all.filter(function (r) {
            var cell = String(r.cells[colIdx] == null ? "" : r.cells[colIdx]).toLowerCase();
            if (op === "2") return cell.indexOf(needle) !== -1;   // Contains
            if (op === "4") return cell === needle;                // Equal To
            return cell.indexOf(needle) === 0;                     // Starts With (default)
          });
        };
        return new Promise(function (resolve) {
          var tries = 0;
          (function harvest() {
            if (opts.signal && opts.signal.aborted) { resolve({ headers: cpSearchHeaders(document), rows: [], totalPages: 1, desc: descLive }); return; }
            var all = cpSearchParseRows(document);
            var hasData = all.length && all.some(function (r) { return r.cells.some(function (c) { return c && c.trim(); }); });
            // A legitimately EMPTY list (legacy "No Entries Present" cell) must NOT be mistaken for a pending async
            // fill — otherwise harvest spins all 60 ticks re-dispatching DOMContentLoaded, and pages that wire their
            // link_<GUID> handlers on DCL (e.g. Device Families) throw "null.addEventListener" up to 60× (a flood +
            // a ~3s stall on every empty list). Marker present ⇒ the server rendered the empty state ⇒ resolve now.
            if (!hasData && !cpSearchHasEmptyMarker(document)) {
              // The fill's data loads async, so the swap-time call rendered empty; re-run the fill until the rows
              // populate. TWO mechanisms for robustness, each tick: (1) re-call the handlers CAPTURED by the
              // re-exec shim (works on a pure in-app nav, where the fill is never on the real document); (2)
              // re-dispatch DOMContentLoaded (fires any fill that registered late on the real document).
              cpDclSpin = true;   // handlers run synchronously in these calls; cpHook drops any nav they fire
              try {
                (window.__cpDclFns || []).forEach(function (fn) { try { fn.call(document, new Event("DOMContentLoaded")); } catch (e) {} });
                try { document.dispatchEvent(new Event("DOMContentLoaded")); } catch (e) {}
              } finally { cpDclSpin = false; }
              if (++tries <= 60) { setTimeout(harvest, 50); return; }   // up to ~3s for the (async) fill data
            }
            var rows = aFilter(all);
            if (opts.onPage) { try { opts.onPage(rows.slice(), 0, 1); } catch (e) {} }
            resolve({ headers: cpSearchHeaders(document), rows: rows, totalPages: 1, desc: descLive });
          })();
        });
      }

      // mainForm transport (Groups/Users) — empty criteria ⇒ ALL rows; pagination loop via page.jsp below.
      // opts.ctx = a REMOTE list's context ({landing, baseParams} — a background-fetched page's mainForm,
      // via cpUxpRemoteCtx): searches then run against THAT list instead of the live page (0.2.342, the
      // export's Users-list cross-reference). The rotating token still comes from the LIVE inputs.
      var landing, params = {};
      if (opts.ctx) {
        landing = opts.ctx.landing;
        for (var bk in opts.ctx.baseParams) if (Object.prototype.hasOwnProperty.call(opts.ctx.baseParams, bk)) params[bk] = opts.ctx.baseParams[bk];
      } else {
        landing = location.origin + location.pathname;   // mainForm posts to the current list URL
        var form = document.querySelector('form[name="mainForm"]');
        if (form) new URLSearchParams(new FormData(form)).forEach(function (v, k) { params[k] = v; });
      }
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

      return cpFollow(landing, params, tok, 0).then(function (res) {
        if (!res || res.auth === false || !res.doc) throw new Error("[search] search POST failed/auth");
        var desc = cpSearchDescriptor(res.doc);
        var po = cpSearchPageOf(res.doc);
        var headers = cpSearchHeaders(res.doc);
        var totalPages = po ? po.total : 1;
        var all = cpSearchParseRows(res.doc);
        var nt = res.doc.getElementsByName("formtokenserial")[0]; if (nt && nt.value) { tok = nt.value; cpWriteToken(tok); }
        if (opts.onDoc) { try { opts.onDoc(res.doc); } catch (e) {} }   // raw fetched doc (the export's own cell parse — [[cpExportUsers]])
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
                if (opts.onDoc) { try { opts.onDoc(r2.doc); } catch (e) {} }
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

    // Redesigned search grid is now the DEFAULT on every host (0.2.193). localStorage is per-origin, so an
    // opt-in flag meant each new host showed the OLD menus until set — friction for the multi-host rollout.
    // Now default-ON with an opt-OUT escape hatch: set localStorage.cpNewSearch="0" to fall back to the legacy
    // in-place list skin.
    function cpNewSearchOn() { try { return localStorage.getItem("cpNewSearch") !== "0"; } catch (e) { return true; } }

    // A page eligible for the redesigned grid: the legacy #searchTable search pages (Groups/Users/Service
    // Instances) OR an Admins-style list — a readable {returnPage,tableName} descriptor + a find form (indexed
    // findKey0 or non-indexed findKey) + a sortable result list. Generic, so any descriptor-backed BroadWorks
    // list page lights up; a transport failure falls back to the legacy table (cpGridFallback), so untested
    // pages degrade gracefully rather than strand the user.
    function cpIsGridListPage() {
      // Assign-picker pages (Assign Domains & family) carry #searchTable (the available-side search)
      // but are NOT results lists — the dual pick-list must stay visible, so the grid never claims them.
      if (document.querySelector('input[name="toAdd"]') && document.querySelector('select[name="availableList"]')) return false;
      if (document.getElementById("searchTable")) return true;
      if (!cpSearchDescriptor(document)) return false;
      return !!(document.querySelector('#findKey0, select[name="findKey"]') &&
                document.querySelector('a.listSortHeader, tr[id^="Row"]'));
    }

    // --- THE SEARCH GRID (redesign) — filter bar + preload-all + fit-to-screen + horizontal page-flip ----
    // Faithful port of the APPROVED mockup (Testing HTML Files/groups-redesign-v2.html) into the live shell.
    // Built in pjax MAIN (alongside cpListSearch + cpBuildConsole — keeps the data and DOM in one world);
    // styled by skin.css (.cp-srch-*, privileged). Default-ON (opt-out localStorage.cpNewSearch="0" → legacy
    // in-place list skin). pjax owns html.cp-grid-on (set when the
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
    var CP_SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';
    var CP_SVG_ARRUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
    var CP_SVG_ARRDOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    var CP_SVG_BUILDING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>';
    var CP_SVG_MOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/></svg>';
    var CP_SVG_FACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
    var CP_SVG_FUNNEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/></svg>';
    var CP_SVG_ID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.8"/><path d="M5.4 16c.5-1.7 5.7-1.7 6.2 0M14 9.5h4M14 13h4"/></svg>';
    var CP_SVG_SEARCHOFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M4 4 18 18"/></svg>';
    var CP_SVG_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
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
      "alternate user ids": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0v-1.5a9 9 0 1 0 -5.5 8.28"/></svg>',
      "administrators": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5 -3.5 7.5 -7.66 8.95a1 1 0 0 1 -.67 -.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1 -1c2 0 4.5 -1.2 6.24 -2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M6.376 18.91a6 6 0 0 1 11.249 .003"/><circle cx="12" cy="11" r="4"/></svg>',
      "call recording platforms": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>',
      "device management device families": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/></svg>',
      "device management tag sets": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z"/><path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193"/><circle cx="10.5" cy="6.5" r=".5" fill="currentColor"/></svg>',
      "mobile subscriber directory numbers": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8.5l4.5 4.5v12.5a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1"/><path d="M9 11h3v6"/><path d="M15 17v.01"/><path d="M15 14v.01"/><path d="M15 11v.01"/><path d="M9 14v.01"/><path d="M9 17v.01"/></svg>',
      "identity/device endpoints": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5"/><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5"/><path d="M3 21l2.5 -2.5"/><path d="M18.5 5.5l2.5 -2.5"/><path d="M10 11l-2 2"/><path d="M13 14l-2 2"/></svg>',
      "identity/device profile types": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1l0 -2"/><path d="M4 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6"/><path d="M14 12l6 0"/><path d="M14 16l6 0"/><path d="M14 20l6 0"/></svg>',
      "identity/device profile inventory": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"/><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"/><path d="M9 12l.01 0"/><path d="M13 12l2 0"/><path d="M9 16l.01 0"/><path d="M13 16l2 0"/></svg>',
      "domains": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 7a9 9 0 0 0 -7.5 -4a8.991 8.991 0 0 0 -7.484 4"/><path d="M11.5 3a16.989 16.989 0 0 0 -1.826 4"/><path d="M12.5 3a16.989 16.989 0 0 1 1.828 4"/><path d="M19.5 17a9 9 0 0 1 -7.5 4a8.991 8.991 0 0 1 -7.484 -4"/><path d="M11.5 21a16.989 16.989 0 0 1 -1.826 -4"/><path d="M12.5 21a16.989 16.989 0 0 0 1.828 -4"/><path d="M2 10l1 4l1.5 -4l1.5 4l1 -4"/><path d="M17 10l1 4l1.5 -4l1.5 4l1 -4"/><path d="M9.5 10l1 4l1.5 -4l1.5 4l1 -4"/></svg>',
      "numbers": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l14 0"/><path d="M5 15l14 0"/><path d="M11 4l-4 16"/><path d="M17 4l-4 16"/></svg>',
      "numbers usage": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6"/><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10"/><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14"/><path d="M4 20h14"/></svg>',
      "enterprise trunk number ranges": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.875 12c.621 0 1.125 .512 1.125 1.143v5.714c0 .631 -.504 1.143 -1.125 1.143h-15.875a1 1 0 0 1 -1 -1v-5.857c0 -.631 .504 -1.143 1.125 -1.143h15.75"/><path d="M9 12v2"/><path d="M6 12v3"/><path d="M12 12v3"/><path d="M18 12v3"/><path d="M15 12v2"/><path d="M3 3v4"/><path d="M3 5h18"/><path d="M21 3v4"/></svg>',
      "enterprise trunk number prefixes": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l2 -2v8"/><path d="M9 8h3a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 0 -1 1v2a1 1 0 0 0 1 1h3"/><path d="M17 8h2.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1 -1.5 1.5h-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1 -1.5 1.5h-2.5"/></svg>',
      "xsi policy profile": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h5"/><path d="M12 16v-8h3a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-3"/><path d="M20 8v8"/><path d="M9 16v-5.5a2.5 2.5 0 0 0 -5 0v5.5"/></svg>',
      "call notify": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>',
      "collaborate": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12v3a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10a1 1 0 0 1 1 -1h9"/><path d="M7 20l10 0"/><path d="M9 16l0 4"/><path d="M15 16l0 4"/><path d="M17 4h4v4"/><path d="M16 9l5 -5"/></svg>',
      "emergency zones": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M15.005 19.31l-1.591 1.59a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 13.592 -4.638"/><path d="M19 16v3"/><path d="M19 22v.01"/></svg>',
      "voice messaging": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="4"/><circle cx="18" cy="12" r="4"/><line x1="6" x2="18" y1="16" y2="16"/></svg>',
      "emergency call notification": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 16v-4a4 4 0 0 1 8 0v4"/><path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7"/><path d="M6 17a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1l0 -2"/></svg>',
      "mail parameters": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v5"/><path d="M3 7l9 6l9 -6"/><path d="M17.001 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M19.001 15.5v1.5"/><path d="M19.001 21v1.5"/><path d="M22.032 17.25l-1.299 .75"/><path d="M17.27 20l-1.3 .75"/><path d="M15.97 17.25l1.3 .75"/><path d="M20.733 20l1.3 .75"/></svg>',
      "call center profile": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-3a8 8 0 1 1 16 0v3"/><path d="M18 19c0 1.657 -2.686 3 -6 3"/><path d="M4 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3"/><path d="M15 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3"/></svg>',
      "meet-me profile": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4"/><path d="M3 8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -8"/></svg>',
      "schedules": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/><path d="M8 15h2v2h-2z"/></svg>',
      "call processing policies": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M6 4v4"/><path d="M6 12v8"/><path d="M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M12 4v10"/><path d="M12 18v2"/><path d="M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M18 4v1"/><path d="M18 9v11"/></svg>',
      "dial plan policy": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h4v4h-4z"/><path d="M10 3h4v4h-4z"/><path d="M17 3h4v4h-4z"/><path d="M3 10h4v4h-4z"/><path d="M10 10h4v4h-4z"/><path d="M17 10h4v4h-4z"/><path d="M10 17h4v4h-4z"/></svg>',
      "routing profile": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4"/><path d="M11 19h5.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h4.5"/></svg>',
      "dialable caller id": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v10a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -10"/><path d="M7 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M15 8l2 0"/><path d="M15 12l2 0"/><path d="M7 16l10 0"/></svg>',
      "carriers": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M16.616 13.924a5 5 0 1 0 -9.23 0"/><path d="M20.307 15.469a9 9 0 1 0 -16.615 0"/><path d="M9 21l3 -9l3 9"/><path d="M10 19h4"/></svg>',
      "assign domains": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.94 13.045a9 9 0 1 0 -8.953 7.955"/><path d="M3.6 9h16.8"/><path d="M3.6 15h9.4"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a16.991 16.991 0 0 1 2.529 10.294"/><path d="M16 22l5 -5"/><path d="M21 21.5v-4.5h-4.5"/></svg>',
      "imrns": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/><path d="M15 9l5 -5"/><path d="M15 5l0 4l4 0"/></svg>'
    };
    // Mirrors skin.js cpMenuItemIcon's normalization so the list AND the Modify grid (Tags/Regions) headers resolve
    // to the tags icon, not just the bare list title.
    function cpHeaderIcon(title) {
      var t = (title || "").trim().toLowerCase();
      if (/^device management (tag sets|regions)( (add|add tag|modify|modify tag))?$/.test(t)) t = "device management tag sets";
      if (/^identity\/device profile type (add|modify)$/.test(t)) t = "identity/device profile types";
      if (/^domains add$/.test(t)) t = "domains";
      if (/^xsi policy profile usage$/.test(t)) t = "xsi policy profile";
      if (/^schedule (modify|add)$/.test(t)) t = "schedules";
      if (/^dialable caller id criteria (add|modify)$/.test(t)) t = "dialable caller id";
      if (/^carriers (add|modify)$/.test(t)) t = "carriers";
      if (/^assign xsi policy profile$/.test(t)) t = "xsi policy profile";
      if (/^assign imrns$/.test(t)) t = "imrns";
      return CP_HDR_ICONS[t] || "";
    }

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
      ],
      // Reseller Administrators (findAll.jsp-style): Administrator ID (id link/drill), Last Name, First Name.
      resellerAdmins: [
        { type: "id" }, { type: "text" }, { type: "text" }
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
    // Harvest pre-list label:value SETTINGS rows (e.g. Call Recording Platforms' "System Default" /
    // "Reseller Default") so the grid surfaces them above the list instead of dropping them. A settings row =
    // a <tr> with a label cell ending in ":" + a value cell, NOT a results-table data/header row. Read-only
    // display of the current value (a control's selected text); the legacy page stays the editable source.
    function cpGridHarvestSettings(cell) {
      var out = [], seen = {};
      var sh = cell.querySelector("a.listSortHeader");
      var resultsTable = sh ? sh.closest("table") : null;
      [].slice.call(cell.querySelectorAll("tr")).forEach(function (tr) {
        if (out.length >= 8) return;
        if (tr.id && /^Row/.test(tr.id)) return;
        if (tr.querySelector("a.listSortHeader")) return;
        if (resultsTable && resultsTable.contains(tr)) return;
        var tds = [].slice.call(tr.children).filter(function (c) { return c.tagName === "TD"; });
        if (tds.length < 2) return;
        var label = (tds[0].textContent || "").replace(/\s+/g, " ").trim();
        if (!label || label.length > 60 || !/:\s*$/.test(label)) return;
        label = label.replace(/:\s*$/, "");
        if (seen[label]) return; seen[label] = 1;
        var ctrl = tds[1].querySelector("select, input:not([type=hidden]):not([type=button]):not([type=submit]), textarea");
        if (ctrl && ctrl.name === "newTagSetName") return;   // surfaced as an EDITABLE field by cpGridBuildSubnav, not a read-only default
        var value;
        if (ctrl) {
          if (ctrl.tagName === "SELECT") { var o = ctrl.options[ctrl.selectedIndex]; value = o ? (o.textContent || "").trim() : ""; }
          else value = ctrl.value || "";
        } else value = (tds[1].textContent || "").replace(/\s+/g, " ").trim();
        out.push({ label: label, value: value });
      });
      return out;
    }

    function cpBuildSearchGrid() {
      var cell = document.querySelector('td[width="82%"]');
      if (!cell) return;
      if (cell.querySelector(".cp-search-redesign")) return;   // already built for this page
      cpFieldMetaCache = {};   // per-group: the department list differs by page, so don't carry it across builds
      var root = document.documentElement;
      root.classList.add("cp-grid-on");
      // skin.js's suppressEmptyResults runs on the EARLY (pre-grid) pass and can leave a legacy "No results"
      // empty-alert stranded at the top of the content (it inserts ABOVE the cell, so wiping the cell below
      // doesn't clear it). The grid renders its OWN empty state ("No results found"), so that banner is redundant
      // and showed in the header on first entry to an empty list. Drop it — the grid is now authoritative for this
      // list's empty state. (The legacy-fallback skinner keeps its alert: it never reaches cpBuildSearchGrid.)
      try { document.querySelectorAll(".cp-alert[data-cp-empty]").forEach(function (a) { a.remove(); }); } catch (e) {}

      // Title + criteria options from the live page BEFORE we wipe it.
      var title = (document.title || "").split(":").pop().trim() || "Search";
      // Read from the live search form: #findKey0/#findOp0 (Groups/Users, indexed) OR the non-indexed
      // findKey/findOp (Admins-style findAll pages).
      var keySel = document.querySelector('#findKey0') || document.querySelector('select[name="findKey"]');
      var opSel = document.querySelector('#findOp0') || document.querySelector('select[name="findOp"]');
      var fieldOpts = keySel ? [].map.call(keySel.options, function (o) { return { value: o.value, label: (o.textContent || "").trim() }; }) : [];
      var opOpts = opSel ? [].map.call(opSel.options, function (o) { return { value: o.value, label: (o.textContent || "").trim() }; }) : [];
      if (!fieldOpts.length) fieldOpts = [{ value: "", label: "All" }];
      if (!opOpts.length) opOpts = [{ value: "STARTS_WITH", label: "Starts With" }, { value: "CONTAINS", label: "Contains" }, { value: "EQUAL_TO", label: "Equal To" }];

      // Pre-list settings (e.g. Call Recording Platforms' System/Reseller Default) → an info strip above the
      // filter bar, read from the live page BEFORE we hide it.
      var settingsHtml = "";
      try {
        var defs = cpGridHarvestSettings(cell);
        if (defs.length) {
          settingsHtml = '<div class="cp-srch-defaults">' + defs.map(function (s) {
            var v = (s.value && s.value.trim())
              ? '<span class="cp-srch-def-v">' + cpEsc(s.value) + '</span>'
              : '<span class="cp-srch-def-v cp-srch-def-empty">None</span>';
            return '<div class="cp-srch-def"><span class="cp-srch-def-k">' + cpEsc(s.label) + '</span>' + v + '</div>';
          }).join("") + '</div>';
        }
      } catch (e) { settingsHtml = ""; }

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
        '<div class="cp-srch-subnav"></div>' +
        settingsHtml +
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
          '<div class="cp-srch-delbar" role="region" aria-label="Selected rows actions">' +
            '<span class="cp-srch-delcount">0 selected</span>' +
            '<button type="button" class="cp-srch-delclear">Clear</button>' +
            '<button type="button" class="cp-srch-deldo">' + CP_SVG_TRASH + '<span>Delete</span></button>' +
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
        accum: 0, cooling: false, criteriaCount: 1, fieldOpts: fieldOpts, opOpts: opOpts,
        // Admins-style list: no #searchTable, and the page exposes its own doFind/doFindAll (redirectPost →
        // find.jsp/findAll.jsp). Such pages SEARCH server-side — drive their own functions (scales to
        // server-paginated lists; the grid re-skins whatever the page renders) rather than filtering locally.
        legacySearch: (!document.getElementById("searchTable") && typeof window.doFind === "function")
      };
      // SP/Group SCHEDULE MODIFY (the events host): present the page AS the events popup once the
      // preload lands — the FALLBACK for anything that still lands here (reload recovery, a failed
      // background fetch). The normal path never navigates: the Schedules LIST intercepts the row
      // click and opens the background popup (state.schedList → cpEventsPopupBg).
      var cpCurPagePath = document.documentElement.getAttribute("data-cp-path") || location.pathname;
      state.pickerAuto = /\/(ServiceProvider|Group)\/Schedules\/Modify\//.test(cpCurPagePath);
      state.schedList = /\/(ServiceProvider|Group)\/Schedules\/(index\.jsp)?$/.test(cpCurPagePath);
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
      cpGridBuildSubnav(state);    // tabbed sub-pages (Tag Set Modify: Tags|Regions) + editable rename field
      cpGridSetupDelete(state);    // multi-select delete on lists that expose a legacy delete-checkbox column

      // Groups/Users: NO auto-load — show the "click to search" INITIAL state (their lists are huge; auto-load
      // would hammer a big preload + the token-rotating fetches on every visit). Admins-style pages already have
      // their FULL list rendered in the page, and the harvest is a local DOM read (instant, no fetch), so
      // auto-show it — matching the legacy page, which lands with the list already populated.
      if (!document.getElementById("searchTable")) cpGridLoad(state, null);
      else cpGridShowState(state, "initial");
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
    // Extract a harvested action button's navigation target from its inline-script wiring. BroadSoft wires these
    // buttons on DOMContentLoaded (`getElementById(id).addEventListener("click", ()=>redirectPost(url,{params}))`),
    // and that registration FAILS to re-attach after an in-shell pjax swap (the DCL re-exec throws on the missing
    // element → "DCL err … addEventListener null") — so forwarding `.click()` to the legacy button silently no-ops
    // (the "Add does nothing in-shell" bug). Reading the target from the script and calling redirectPost directly
    // keeps Add/Import working in-shell regardless (Add = relative "Add/index.jsp" → cpHook resolves it against the
    // list landing; Import = the absolute Operator/System Import url). See [[feedback-everything-through-pjax]].
    function cpGridActionTarget(el) {
      if (!el || !el.id) return null;
      var scripts = [].slice.call(document.querySelectorAll('script:not([src])')).map(function (s) { return s.textContent || ""; }).join("\n");
      var i = scripts.indexOf(el.id);
      if (i < 0) return null;
      var chunk = scripts.slice(i, i + 400);
      var m = /redirectPost\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/.exec(chunk);
      if (!m) return null;
      var url = m[1].replace(/\\u002F/g, "/");
      var params = {}, re = /(\w+)\s*:\s*['"]([^'"]*)['"]/g, mm;
      while ((mm = re.exec(m[2]))) params[mm[1]] = mm[2].replace(/\\u003E/g, ">").replace(/\\u0025/g, "%").replace(/\\u002F/g, "/");
      return { url: url, params: params };
    }
    // BroadWorks table cells often rely on a DOMContentLoaded listener bound
    // to RowNColN. On some list responses that listener is absent after a
    // PJAX swap even though the adjacent Edit link works. Use the row's own
    // redirectPost wiring for a clicked value, so its drill-in is reliable.
    document.addEventListener("click", function (ev) {
      var link = ev.target && ev.target.closest ?
        ev.target.closest('td[width="82%"] tr[id^="Row"] a.tableLink[id]') : null;
      if (!link) return;
      var target = cpGridActionTarget(link);
      if (!target || !isPjaxUrl(target.url)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.redirectPost(target.url, target.params);
    }, true);
    // Export action wiring. The legacy Export button calls `exportComponent(component, contextPath, pagePath,
    // tokenName)` (defined in Scripts/deviceManagementExport.js) — a script the FULL Modify page loads but that pjax
    // does NOT carry over on an in-shell swap, so exportComponent is UNDEFINED and forwarding the click no-ops. We
    // extract its args from the inline wiring and run our own equivalent (cpExportComponent). See
    // [[feedback-everything-through-pjax]], [[gotcha-export-blob-download]].
    function cpGridExportTarget(el) {
      if (!el || !el.id) return null;
      var scripts = [].slice.call(document.querySelectorAll('script:not([src])')).map(function (s) { return s.textContent || ""; }).join("\n");
      var i = scripts.indexOf(el.id);
      if (i < 0) return null;
      var m = /exportComponent\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(scripts.slice(i, i + 450));
      if (!m) return null;
      var dec = function (s) { return (s || "").replace(/\\u002F/g, "/").replace(/\\u0025/g, "%"); };
      return { component: dec(m[1]), contextPath: dec(m[2]), pagePath: dec(m[3]), tokenName: dec(m[4]) };
    }
    // Replicates legacy exportComponent (deviceManagementExport.js) but downloads via a BLOB instead of
    // `location.href = proxy`. The proxy is a /commpilot/ URL, so the legacy GET nav would be caught by our DNR
    // recovery redirect (GET main_frame) → styles.css → no download. Fetch+blob+<a download> never touches
    // main_frame, so DNR can't interfere. Server contract (verified): POST <pagePath>/index.jsp?key=<component>
    // &export=&<tokenName>=<token> → body has <proxy>URL</proxy>; GET that URL → the file (Content-Disposition).
    function cpExportComponent(component, contextPath, pagePath, tokenName) {
      try {
        var tokEl = (document.mainForm && document.mainForm.elements[tokenName]) || document.getElementsByName(tokenName)[0];
        var tok = tokEl ? tokEl.value : "";
        var postUrl = contextPath + pagePath + "/index.jsp?key=" + encodeURIComponent(component) + "&export=";
        if (tok) postUrl += "&" + tokenName + "=" + encodeURIComponent(tok);
        fetch(postUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, credentials: "same-origin", redirect: "manual" })
          .then(function (r) {
            // redirect:"manual" — a session bounce (http:// Login) would otherwise CSP-fail as "Failed to fetch"
            // + a connect-src violation; an opaqueredirect resolves so we fail soft with a clear message.
            if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) { console.warn("[pjax] export: session bounce — please sign in again"); return null; }
            return r.text();
          })
          .then(function (txt) {
            if (txt == null) return;
            var s = txt.indexOf("<proxy>"), e = txt.indexOf("</proxy>");
            if (s < 0 || e <= s) { console.warn("[pjax] export: no proxy in response"); return; }
            var proxy = txt.substring(s + 7, e);
            return fetch(proxy, { credentials: "same-origin" }).then(function (pr) {
              var cd = pr.headers.get("content-disposition") || "";
              var fm = /filename="?([^";]+)"?/.exec(cd);
              var fname = fm ? fm[1].trim() : (component + ".zip");
              return pr.blob().then(function (blob) {
                var u = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = u; a.download = fname; a.style.display = "none";
                document.body.appendChild(a); a.click();
                setTimeout(function () { try { a.remove(); URL.revokeObjectURL(u); } catch (x) {} }, 1500);
              });
            });
          })
          .catch(function (err) { console.warn("[pjax] export failed:", err); });
      } catch (e) { console.warn("[pjax] cpExportComponent:", e); }
    }
    // FORM-page Export (e.g. Identity/Device Profile Type Modify): same exportComponent wiring as the grid
    // Export action, but the button sits in a settings form's button bar (skin.js forward-clicks the real
    // input). The legacy handler both dies after an in-shell swap (exportComponent undefined) AND, on a full
    // load, navigates location.href to a /commpilot/ proxy GET our DNR recovery redirect eats — so intercept
    // at document CAPTURE (fires before the element's own listener), stop the event, and run the blob path.
    // Non-exportComponent export buttons fall through untouched. [[gotcha-export-blob-download]]
    document.addEventListener("click", function (ev) {
      try {
        var b = ev.target && ev.target.closest ? ev.target.closest('input[name="export"]') : null;
        if (!b) return;
        var tgt = cpGridExportTarget(b);
        if (!tgt) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        cpExportComponent(tgt.component, tgt.contextPath, tgt.pagePath, tgt.tokenName);
      } catch (e) {}
    }, true);
    // ---- EXPORT ALL USERS (0.2.337) — one-click CSV of an entire list page's population. Built for the
    // Group Directory (Group > Utilities > Group Directory: Name/User ID/Phone/Extension/Department/Mobile/
    // E-mail/…) but generic over any grid list whose criteria fields include an enumerable Department
    // (Group > Users too). The server caps a single search (~1000, Error 4027), so the engine first tries
    // ONE blank search (small groups: done in a single pass) and, when the server refuses, tiles the
    // population DEPARTMENT BY DEPARTMENT via cpResolveFieldMeta's option list (each department stays under
    // the cap) — the same technique as the manual workflow this replaces, minus the hours. STRICTLY
    // SEQUENTIAL: every search threads the rotating single-use formtokenserial through cpListSearch/cpFollow
    // (concurrency would race the token → logout, same hazard as the deep sweep). Rows are parsed from the
    // RAW fetched docs (cpListSearch opts.onDoc) with a per-<td> reader that PRESERVES EMPTY CELLS — the
    // a.tableLink cell parse the grid uses can drop link-less empties (Mobile/E-mail/YahooID are often
    // blank on the directory), which would shift columns in the CSV. Download = blob + <a download>, never
    // a /commpilot/ GET nav (the DNR recovery redirect eats those — [[gotcha-export-blob-download]]).
    var cpUxpEl = null;
    function cpUxpClose() {
      document.removeEventListener("keydown", cpUxpKey, true);
      if (cpUxpEl) { try { cpUxpEl.remove(); } catch (e) {} }
      cpUxpEl = null;
    }
    function cpUxpKey(e) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      var c = cpUxpEl && cpUxpEl._cpCancel;
      if (c) { try { c(); } catch (x) {} } else cpUxpClose();
    }
    // The criteria fields the export engine can drive, by label. first+id ⇒ the PROVEN deep-sweep combo
    // (First-Name prefix buckets + a User-ID cross-check pass — the same method the Users grid's "Load all"
    // uses, 100% coverage live-verified); dept alone ⇒ the department-by-department fallback.
    function cpUxpFields(state) {
      var find = function (re) {
        var f = (state.fieldOpts || []).filter(function (o) { return re.test((o.label || "").trim()); });
        return f.length ? f[0] : null;
      };
      return { first: find(/^first\s*name$/i), id: find(/^user\s*id$/i), dept: find(/^department$/i) };
    }
    // Safe special chars for name buckets — the common name punctuation, WITHOUT the SQL wildcards (% _):
    // on silently-capping lists there is no matchCount, so the deep sweep's no-progress guard can't detect a
    // server-ignored wildcard and "%" would recurse the whole population to max depth.
    var CP_UXP_SPECIALS = "'-.,&()@#$!^*+=<>?/:;~".split("");
    // Child prefixes for an over-cap bucket. Numeric User-ID prefixes stay digit-only (phone-number IDs);
    // after a space only name chars follow (never two spaces — the proven anti-spiral rule); otherwise the
    // full alphanumeric set, plus space+punctuation for names (catches "M Sandeep"-style first names).
    function cpUxpKids(prefix, idMode) {
      var set;
      if (idMode && /^[0-9]+$/.test(prefix)) set = CP_SWEEP_DIGITS;
      else if (/\s$/.test(prefix)) set = CP_SWEEP_BASE;
      else set = idMode ? CP_SWEEP_BASE : CP_SWEEP_BASE.concat([" "]).concat(CP_UXP_SPECIALS);
      return set.map(function (c) { return prefix + c; });
    }
    // A text-ish field for the blank "everything" probe. NOT the enumerated Department/Trunk selects — the
    // live legacy form can hold a REAL selection in findValue0 (the dept dropdown defaults to its first
    // department), so posting the form as-is would run a department search, not a show-all.
    function cpUxpBlankField(state) {
      var f = (state.fieldOpts || []).filter(function (o) { return o.value && !/department|trunk/i.test(o.label || ""); });
      return f.length ? f[0] : ((state.fieldOpts || [])[0] || null);
    }
    // Per-row cell parse that KEEPS empty cells. Prefer the a.tableLink-bearing <td>s when they account for
    // every header column (the Users/Groups list shape). Link-less tables (Group Directory rows aren't
    // clickable) interleave SPACER <td>s between the data cells — verified live on /Group/CompanyDir/:
    // 19 tds = width="20" lead + 9 data + width="0" spacer after each. Drop the width="0" spacers, then
    // trim empty width-attributed padding from the edges until the header count fits.
    function cpUxpParseDoc(doc, out) {
      if (!out.headers) { var h = cpSearchHeaders(doc); if (h && h.length) out.headers = h; }
      var hn = out.headers ? out.headers.length : 0;
      var txt = function (td) {
        var t = (td.textContent || "").replace(/\s+/g, " ").trim();
        if (!t && td.querySelector("img")) t = "✓";   // boolean columns render a checkmark image
        return t;
      };
      // Link cells (Users list): the <td> ALSO holds an inline <script> wiring the drill-in, so td.textContent
      // is a ~580-char script blob. Read the a.tableLink ANCHOR text instead (the clean cell value); img→✓.
      var linkTxt = function (td) {
        var a = td.querySelector("a.tableLink");
        var t = a ? (a.textContent || "").replace(/\s+/g, " ").trim() : "";
        if (!t && td.querySelector("img")) t = "✓";
        return t;
      };
      var raw = 0;   // rows seen in THIS doc before dedupe — the caller's bucket-size signal (silent-cap detection)
      doc.querySelectorAll('tr[id^="Row"]').forEach(function (tr) {
        var tds = [].filter.call(tr.children, function (td) { return td.tagName === "TD"; });
        var linkTds = tds.filter(function (td) { return td.querySelector("a.tableLink"); });
        var cells;
        if (hn && linkTds.length === hn) cells = linkTds.map(linkTxt);
        else {
          var dataTds = tds.filter(function (td) { return td.getAttribute("width") !== "0"; });
          while (hn && dataTds.length > hn && dataTds[0].getAttribute("width") && !txt(dataTds[0])) dataTds.shift();
          while (hn && dataTds.length > hn && dataTds[dataTds.length - 1].getAttribute("width") && !txt(dataTds[dataTds.length - 1])) dataTds.pop();
          cells = dataTds.map(txt);
          if (hn) {
            while (cells.length > hn && !cells[cells.length - 1]) cells.pop();
            while (cells.length > hn && !cells[0]) cells.shift();
          }
        }
        if (!cells.some(function (c) { return c; })) return;
        raw++;
        var key = cells.join("\u0001");
        if (out.seen[key]) return;   // dedupe (buckets overlap across sweep passes)
        out.seen[key] = 1;
        out.rows.push(cells);
      });
      return raw;
    }
    // ---- Minimal XLSX writer (0.2.341; report-sourced 0.2.344) — store-only ZIP + inline-string OOXML,
    // zero libraries (MV3 content script, no bundler). Styling = Trifecta LIGHT (user-approved): purple
    // #5A2D82 header (white bold Calibri 11), faint purple #F6F2FA banding, thin #DDD borders, ALL cells
    // CENTERED, frozen header, NO autofilter dropdowns, auto-fit column widths, orange "All Users" tab /
    // purple department tabs. Numeric cells without leading zeros are real numbers (no green triangles);
    // leading-zero values ("01660") stay text.
    var cpCrcT = null;
    function cpCrc32(b) {
      if (!cpCrcT) { cpCrcT = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); cpCrcT[n] = c >>> 0; } }
      var crc = 0xFFFFFFFF;
      for (var i = 0; i < b.length; i++) crc = cpCrcT[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    // STORE-method ZIP → Uint8Array. files: [{name, data(string|Uint8Array)}].
    function cpZipBytes(files) {
      var enc = new TextEncoder(), parts = [], cd = [], off = 0;
      var u16 = function (v) { return [v & 255, (v >> 8) & 255]; };
      var u32 = function (v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; };
      files.forEach(function (f) {
        var nb = enc.encode(f.name), data = (typeof f.data === "string") ? enc.encode(f.data) : f.data;
        var crc = cpCrc32(data);
        var lh = new Uint8Array([].concat([80, 75, 3, 4], u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0)));
        parts.push(lh, nb, data);
        cd.push({ nb: nb, crc: crc, sz: data.length, off: off });
        off += lh.length + nb.length + data.length;
      });
      var cdParts = [], cdSize = 0;
      cd.forEach(function (c) {
        var h = new Uint8Array([].concat([80, 75, 1, 2], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(c.crc), u32(c.sz), u32(c.sz), u16(c.nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off)));
        cdParts.push(h, c.nb); cdSize += h.length + c.nb.length;
      });
      var end = new Uint8Array([].concat([80, 75, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(off), u16(0)));
      // Flatten to one Uint8Array (needed so an xlsx can be nested inside the outer .zip).
      var total = 0, all = parts.concat(cdParts, [end]);
      all.forEach(function (p) { total += p.length; });
      var buf = new Uint8Array(total), pos = 0;
      all.forEach(function (p) { buf.set(p, pos); pos += p.length; });
      return buf;
    }
    function cpZipStore(files, mime) { return new Blob([cpZipBytes(files)], { type: mime || "application/zip" }); }
    function cpXmlEsc(v) {
      return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function cpColRef(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
    // Styles: 0 default · 1 header (purple fill, white bold, centered) · 2 data (centered, bordered) ·
    // 3 banded (centered, bordered, faint-purple fill). All centered per user request.
    var CP_XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF5A2D82"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF6F2FA"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFDDDDDD"/></left><right style="thin"><color rgb="FFDDDDDD"/></right><top style="thin"><color rgb="FFDDDDDD"/></top><bottom style="thin"><color rgb="FFDDDDDD"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    function cpXlsxSheetXml(sheet) {
      var cols = "";
      (sheet.widths || []).forEach(function (w, i) { cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"' +
        (sheet.textColumns && sheet.textColumns.indexOf(i) !== -1 ? ' style="4"' : '') + '/>'; });
      var row = function (r, cells, band) {
        var s = (r === 1) ? 1 : (band ? 3 : 2);
        var o = '<row r="' + r + '">';
        for (var i = 0; i < cells.length; i++) {
          var ref = cpColRef(i) + r, v = cells[i];
          var cellStyle = r > 1 && sheet.textColumns && sheet.textColumns.indexOf(i) !== -1 ? 4 : s;
          if (v == null || v === "") o += '<c r="' + ref + '" s="' + cellStyle + '"/>';
          else if (cellStyle !== 4 && r > 1 && /^[1-9]\d{0,14}$/.test(v)) o += '<c r="' + ref + '" s="' + cellStyle + '"><v>' + v + "</v></c>";
          else o += '<c r="' + ref + '" s="' + cellStyle + '" t="inlineStr"><is><t xml:space="preserve">' + cpXmlEsc(v) + "</t></is></c>";
        }
        return o + "</row>";
      };
      var body = [row(1, sheet.headers, false)];
      sheet.rows.forEach(function (rr, i) { body.push(row(i + 2, rr, i % 2 === 1)); });
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        (sheet.tabColor ? '<sheetPr><tabColor rgb="' + sheet.tabColor + '"/></sheetPr>' : "") +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        (cols ? "<cols>" + cols + "</cols>" : "") +
        "<sheetData>" + body.join("") + "</sheetData></worksheet>";   // NO autoFilter — user asked for no header dropdowns
    }
    function cpXlsxBuild(sheets) {   // sheets: [{name, headers, rows, widths, tabColor}] → Uint8Array (xlsx bytes)
      var files = [], overrides = "", wbSheets = "", rels = "";
      sheets.forEach(function (s, i) {
        var n = i + 1;
        files.push({ name: "xl/worksheets/sheet" + n + ".xml", data: cpXlsxSheetXml(s) });
        overrides += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        wbSheets += '<sheet name="' + cpXmlEsc(s.name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
        rels += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
      });
      files.push({ name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + overrides +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' });
      files.push({ name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
      files.push({ name: "xl/workbook.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + wbSheets + "</sheets></workbook>" });
      files.push({ name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
      files.push({ name: "xl/styles.xml", data: CP_XLSX_STYLES });
      return cpZipBytes(files);
    }
    window.cpXlsxBuild = cpXlsxBuild;
    // Excel sheet names: ≤31 chars, no []:*?/\ — sanitize + dedupe (truncation collisions get " (2)"…).
    function cpXlsxSheetName(label, used) {
      var n = String(label || "Sheet").replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "");
      if (!n) n = "Sheet";
      if (n.length > 31) n = n.slice(0, 31).trim();
      var base = n, k = 2;
      while (used[n.toLowerCase()]) { var suf = " (" + k + ")"; n = base.slice(0, 31 - suf.length).trim() + suf; k++; }
      used[n.toLowerCase()] = 1;
      return n;
    }
    // Auto-fit column widths from content (Excel char units): max(header, cells) + padding, clamped.
    function cpUxpWidths(headers, rows) {
      return headers.map(function (h, i) {
        var mx = String(h == null ? "" : h).length;
        for (var r = 0; r < rows.length; r++) { var v = rows[r][i]; var l = v == null ? 0 : String(v).length; if (l > mx) mx = l; }
        return Math.min(60, Math.max(9, mx + 2.5));
      });
    }

    // ---- Group Directory DETAIL report (0.2.344) — the FULL-DATA source (the truncated list can't give full
    // emails; see [[gotcha-group-directory-detail-report]]). POST /commpilot/servlet/ClientBGListServlet with
    // xslURL=bglist_detail.xsl + the live mainForm + a criterion; response = a <row><col> XML island with 25
    // full columns. Run PER DEPARTMENT (each stays under the ~1000 cap), broad if a group has no departments.
    var CP_UXP_REPORT_URL = "/commpilot/servlet/ClientBGListServlet";
    function cpUxpDecodeEnt(s) {
      return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
        .replace(/&amp;/g, "&");
    }
    function cpUxpParseReport(txt) {
      // The data island may be raw <row> or HTML-escaped inside a <textarea>; if no raw rows, decode & retry.
      var scan = function (s) {
        var headings = (s.match(/<colHeading>([\s\S]*?)<\/colHeading>/g) || []).map(function (m) { return cpUxpDecodeEnt(m.replace(/<\/?colHeading>/g, "").trim()); });
        var rows = (s.match(/<row>[\s\S]*?<\/row>/g) || []).map(function (rx) {
          return (rx.match(/<col\/>|<col>[\s\S]*?<\/col>/g) || []).map(function (c) { return c === "<col/>" ? "" : cpUxpDecodeEnt(c.replace(/<\/?col>/g, "").trim()); });
        });
        return { headings: headings, rows: rows };
      };
      var out = scan(txt);
      if (!out.headings.length && /&lt;colHeading&gt;/.test(txt)) out = scan(cpUxpDecodeEnt(txt));
      return out;
    }
    function cpUxpReportFetch(deptValue) {
      var form = document.querySelector('form[name="mainForm"]');
      var params = new URLSearchParams();
      if (form) new URLSearchParams(new FormData(form)).forEach(function (v, k) {
        if (!/^find(Key|Op|Value)\d+$/.test(k) && k !== "rowNum" && k !== "xslURL") params.set(k, v);
      });
      params.set("xslURL", "bglist_detail.xsl");
      params.set("rowNum", "0");
      params.set("findKey0", deptValue != null ? "ExactUserDepartment" : "UserLastName");
      params.set("findOp0", deptValue != null ? "EQUAL_TO" : "STARTS_WITH");
      params.set("findValue0", deptValue != null ? deptValue : "");
      var tokEl = document.getElementsByName("formtokenserial")[0];
      if (tokEl) params.set("formtokenserial", tokEl.value);
      return fetch(location.origin + CP_UXP_REPORT_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "same-origin", redirect: "manual", body: params.toString()
      }).then(function (r) {
        if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) return { auth: false };
        return r.text().then(function (txt) {
          if (/Please login again|not authorized to access the system|<form[^>]+(?:login|password)/i.test(txt)) return { auth: false };
          var report = cpUxpParseReport(txt);
          if (!report.headings.length) throw new Error("CommPilot did not return the directory report");
          return report;
        });
      });
    }
    // Row TYPE: a populated "Service Name" ⇒ a service instance (Hunt Group / Call Center / Auto Attendant /
    // Voice Portal / …) — the entries "Users only" drops. Empty ⇒ a real user (or a conference-room virtual
    // user, which stays). iName/iLast used only to LABEL rooms nicely.
    function cpUxpRowType(r, iSvc, iLast, iName) {
      var svc = (iSvc >= 0 ? r[iSvc] : "") || "";
      svc = svc.trim();
      if (svc) return { type: svc, isService: true };
      var last = (iLast >= 0 ? r[iLast] : "") || "";
      var nm = (iName >= 0 ? r[iName] : "") || "";
      if (/^room$/i.test(last.trim()) || /conference room|conf\.?\s*room/i.test(nm)) return { type: "Conference Room", isService: false };
      return { type: "User", isService: false };
    }
    function cpUxpDownloadBlob(blob, fname) {
      var u = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = u; a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { a.remove(); URL.revokeObjectURL(u); } catch (x) {} }, 4000);
    }
    // Assemble BOTH workbooks from the report rows, filter by mode, package as ONE .zip.
    //  FULL  = All Users sheet + a tab per department; columns = Name(First Last) + Type + all 25 report cols.
    //  Phone Directory (customer) = department tabs only; Name(First Last)/Number/Extension/Department/Email/Notes.
    // mode "users" drops service instances (Service Name populated); "all" keeps everything.
    function cpUxpBuildFiles(data, groupName, mode) {
      var hs = data.headings || [];
      var idx = function (re) { for (var i = 0; i < hs.length; i++) if (re.test(hs[i])) return i; return -1; };
      var iName = idx(/^name$/i), iNum = idx(/^number$/i), iExt = idx(/^extension$/i), iMob = idx(/^mobile$/i),
          iMail = idx(/e-?mail/i), iDept = idx(/^department$/i), iFirst = idx(/^first name$/i),
          iLast = idx(/^last name$/i), iSvc = idx(/service name/i);
      var firstLast = function (r) {
        var f = (iFirst >= 0 ? r[iFirst] : "") || "", l = (iLast >= 0 ? r[iLast] : "") || "";
        f = f.trim(); l = l.trim();
        if (f || l) return (f + " " + l).trim();
        var nm = (iName >= 0 ? r[iName] : "") || "", ci = nm.indexOf(",");
        return ci >= 0 ? (nm.slice(ci + 1) + " " + nm.slice(0, ci)).trim() : nm;
      };
      // Classify + optionally filter.
      var typed = data.rows.map(function (r) { var t = cpUxpRowType(r, iSvc, iLast, iName); return { r: r, type: t.type, isService: t.isService }; });
      var counts = { total: typed.length, users: 0, service: 0, byType: {} };
      typed.forEach(function (x) { if (x.isService) counts.service++; else counts.users++; counts.byType[x.type] = (counts.byType[x.type] || 0) + 1; });
      var kept = (mode === "users") ? typed.filter(function (x) { return !x.isService; }) : typed;
      // Sort by first name then last (A→Z).
      kept.sort(function (a, b) { var ka = firstLast(a.r).toLowerCase(), kb = firstLast(b.r).toLowerCase(); return ka < kb ? -1 : ka > kb ? 1 : 0; });
      // Group by department.
      var byDept = {}, deptNames = [];
      kept.forEach(function (x) { var d = ((iDept >= 0 ? x.r[iDept] : "") || "").trim() || "No Department"; if (!byDept[d]) { byDept[d] = []; deptNames.push(d); } byDept[d].push(x); });
      deptNames.sort(function (a, b) { a = a.toLowerCase(); b = b.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; });

      // FULL columns: Name(First Last), Type, then every report column except the original Name.
      var fullHeaders = ["Name", "Type"].concat(hs.filter(function (h, i) { return i !== iName; }));
      var fullRow = function (x) { var base = [firstLast(x.r), x.type]; hs.forEach(function (h, i) { if (i !== iName) base.push(x.r[i] || ""); }); return base; };
      var custHeaders = ["Name", "Number", "Extension", "Department", "Email Address", "Notes"];
      var custRow = function (x) { return [firstLast(x.r), iNum >= 0 ? x.r[iNum] : "", iExt >= 0 ? x.r[iExt] : "", iDept >= 0 ? x.r[iDept] : "", iMail >= 0 ? x.r[iMail] : "", ""]; };

      var allFullRows = kept.map(fullRow), allCustRows = kept.map(custRow);
      var fullW = cpUxpWidths(fullHeaders, allFullRows), custW = cpUxpWidths(custHeaders, allCustRows);
      // Notes is a blank write-in column — auto-width would collapse it to the header; give it plenty of
      // room so the customer can type without expanding it. (Both files: whichever has a "Notes" column.)
      var wideNotes = function (headers, widths) { var i = headers.indexOf("Notes"); if (i >= 0) widths[i] = 60; };
      wideNotes(fullHeaders, fullW); wideNotes(custHeaders, custW);
      var used1 = {}, sheetsFull = [{ name: cpXlsxSheetName("All Users", used1), headers: fullHeaders, rows: allFullRows, widths: fullW, tabColor: "FFF58025" }];
      deptNames.forEach(function (d) { sheetsFull.push({ name: cpXlsxSheetName(d, used1), headers: fullHeaders, rows: byDept[d].map(fullRow), widths: fullW, tabColor: "FF5A2D82" }); });
      var used2 = {}, sheetsCust = [];
      deptNames.forEach(function (d) { sheetsCust.push({ name: cpXlsxSheetName(d, used2), headers: custHeaders, rows: byDept[d].map(custRow), widths: custW, tabColor: "FF5A2D82" }); });

      var d2 = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
      var stamp = d2.getFullYear() + "-" + p(d2.getMonth() + 1) + "-" + p(d2.getDate());
      var safe = (groupName || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "group";
      var fullName = "Users Export FULL - " + safe + " - " + stamp + ".xlsx";
      var custName = "Phone Directory - " + safe + " - " + stamp + ".xlsx";
      var zip = cpZipStore([
        { name: fullName, data: cpXlsxBuild(sheetsFull) },
        { name: custName, data: cpXlsxBuild(sheetsCust) }
      ]);
      return {
        depts: deptNames.length, counts: counts, kept: kept.length,
        zipBlob: zip, zipName: "Users Export - " + safe + " - " + stamp + ".zip",
        fileNames: [fullName, custName]
      };
    }

    function cpExportUsers(state) {
      if (cpUxpEl) return;
      var deptField = cpUxpFields(state).dept;   // the Department criteria field (composite-keyed)
      var ac = (typeof AbortController !== "undefined") ? new AbortController()
        : { signal: { aborted: false }, abort: function () { this.signal.aborted = true; } };
      if (state._sweepAbort) { try { state._sweepAbort.abort(); } catch (e) {} }
      state._sweepAbort = ac;
      var mode = "users";
      var acc = { headings: null, rows: [], seenUid: {} };
      var CP_UXP_CAPWARN = 950;   // a single department report at/over this may be server-capped
      var capWarns = [];

      var opt = function (val, checked, title, desc) {
        return '<label class="cp-uxp-opt"><input type="radio" name="cp-uxp-mode" value="' + val + '"' + (checked ? " checked" : "") + '/>' +
          '<span class="cp-uxp-optt"><b>' + title + '</b><span>' + desc + '</span></span></label>';
      };
      var back = document.createElement("div");
      back.className = "cp-modal-back";
      back.innerHTML =
        '<div class="cp-modal cp-uxp">' +
          '<div class="cp-modal-head"><span class="cp-uxp-ico">' + CP_SVG_DL + '</span><span>Export directory</span>' +
            '<span class="cp-uxp-x" title="Cancel and close">' + CP_SVG_X + '</span></div>' +
          '<div class="cp-uxp-body">' +
            '<div class="cp-uxp-h">What should the export include?</div>' +
            '<div class="cp-uxp-opts">' +
              opt("users", true, "Users only", "Real people and conference rooms. Hunt groups, call centers, auto attendants and other service lines are dropped.") +
              opt("all", false, "Everything", "Every directory entry, including hunt groups, call centers, auto attendants and voice ports. The full file tags each row’s type.") +
            '</div>' +
            '<div class="cp-uxp-anim cp-uxp-hide">' +
              '<div class="cp-uxp-lens">' + CP_SVG_SEARCH + '</div>' +
            '</div>' +
            '<div class="cp-srch-sweep-barwrap cp-uxp-barwrap cp-uxp-hide"><div class="cp-srch-sweep-fill"></div></div>' +
            '<div class="cp-uxp-n cp-uxp-hide">0</div>' +
            '<div class="cp-uxp-sub cp-uxp-hide"></div>' +
            '<div class="cp-uxp-warns"></div>' +
            '<div class="cp-uxp-note cp-uxp-hide">Keep this tab open and don’t reload while the export runs.</div>' +
            '<div class="cp-uxp-btns">' +
              '<button type="button" class="cp-srch-actbtn cp-uxp-start">' + CP_SVG_DL + '<span>Start export</span></button>' +
              '<button type="button" class="cp-srch-actbtn cp-uxp-dl cp-uxp-hide">' + CP_SVG_DL + '<span>Download .zip</span></button>' +
              '<button type="button" class="cp-srch-actbtn sec cp-uxp-cancel">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(back);
      cpUxpEl = back;
      document.addEventListener("keydown", cpUxpKey, true);
      var hEl = back.querySelector(".cp-uxp-h"), nEl = back.querySelector(".cp-uxp-n"),
          subEl = back.querySelector(".cp-uxp-sub"), warnEl = back.querySelector(".cp-uxp-warns"),
          fillEl = back.querySelector(".cp-srch-sweep-fill"), dlBtn = back.querySelector(".cp-uxp-dl"),
          cancelBtn = back.querySelector(".cp-uxp-cancel"), startBtn = back.querySelector(".cp-uxp-start"),
          lensEl = back.querySelector(".cp-uxp-lens");
      var setH = function (t) { hEl.textContent = t; };
      var setSub = function (t) { subEl.textContent = t; };
      var setBar = function (f) { fillEl.style.width = Math.round(f * 100) + "%"; };
      var setN = function () { nEl.textContent = acc.rows.length.toLocaleString() + " entries"; };
      var addWarn = function (t) { warnEl.classList.add("on"); var d2 = document.createElement("div"); d2.textContent = t; warnEl.appendChild(d2); };
      var halted = function () { return ac.signal.aborted; };
      var running = true;
      var settle = function () { running = false; if (state._sweepAbort === ac) state._sweepAbort = null; };
      var cancel = function () { if (running) { try { ac.abort(); } catch (e) {} settle(); } cpUxpClose(); };
      back._cpCancel = cancel;
      back.querySelector(".cp-uxp-x").addEventListener("click", cancel);
      cancelBtn.addEventListener("click", function () { if (running) cancel(); else cpUxpClose(); });
      var groupNameNow = function () {
        var segs = document.querySelectorAll(".cp-breadcrumb .cp-bc-seg");
        return segs.length ? (segs[segs.length - 1].textContent || "").trim() : (state.entity || "");
      };
      var built = null;
      var ensureBuild = function () {
        if (!built && acc.rows.length) { try { built = cpUxpBuildFiles(acc, groupNameNow(), mode); } catch (e) { addWarn("Workbook build failed: " + e); } }
        return built;
      };
      var downloadZip = function () { if (ensureBuild()) cpUxpDownloadBlob(built.zipBlob, built.zipName); };
      dlBtn.addEventListener("click", downloadZip);

      var finished = false;
      function finish() {
        if (halted() || finished) return;
        finished = true; settle();
        setH("Building Excel files…"); setBar(1); setSub("");
        setTimeout(function () { try { finishBuild(); } catch (e) { addWarn("Workbook build failed: " + e); cancelBtn.textContent = "Close"; } }, 40);
      }
      function finishBuild() {
        if (!ensureBuild()) { setH("Export stopped"); addWarn("No rows to export."); cancelBtn.textContent = "Close"; return; }
        downloadZip();
        var c = built.counts;
        setH("Export complete");
        nEl.textContent = built.kept.toLocaleString() + (mode === "users" ? " users exported" : " entries exported");
        setSub(built.depts + " departments · " + built.zipName);
        addWarn("Breakdown: " + c.total.toLocaleString() + " directory entries = " + c.users.toLocaleString() +
          " users (incl. conference rooms) + " + c.service.toLocaleString() + " service lines" +
          (mode === "users" ? " — service lines EXCLUDED." : " — everything included."));
        var typeBits = Object.keys(c.byType).filter(function (k) { return k !== "User" && k !== "Conference Room"; })
          .sort(function (a, b) { return c.byType[b] - c.byType[a]; })
          .map(function (k) { return k + ": " + c.byType[k].toLocaleString(); });
        if (typeBits.length) addWarn("Service lines by type — " + typeBits.join(", ") + ".");
        capWarns.forEach(function (w) { addWarn(w); });
        dlBtn.classList.remove("cp-uxp-hide");
        cancelBtn.textContent = "Close";
      }
      function fail(msg) {
        if (halted()) return;
        settle();
        setH("Export stopped"); addWarn(msg);
        if (acc.rows.length) { var sp = dlBtn.querySelector("span"); if (sp) sp.textContent = "Download partial .zip"; dlBtn.classList.remove("cp-uxp-hide"); }
        cancelBtn.textContent = "Close";
      }
      // Accumulate a report result (dedupe by User Id across departments).
      function absorb(res, label) {
        if (!acc.headings && res.headings && res.headings.length) acc.headings = res.headings;
        var iUid = acc.headings ? acc.headings.map(function (h) { return h.toLowerCase(); }).indexOf("user id") : -1;
        var added = 0;
        (res.rows || []).forEach(function (r) {
          var uid = (iUid >= 0 ? (r[iUid] || "") : "").trim().toLowerCase();
          var key = uid || ("row:" + r.join("~|~"));
          if (acc.seenUid[key]) return;
          acc.seenUid[key] = 1; acc.rows.push(r); added++;
        });
        if (added >= CP_UXP_CAPWARN) capWarns.push("“" + label + "” returned " + added.toLocaleString() + " rows — may have hit the server cap; some entries could be missing.");
      }
      // Department loop.
      var deptList = null, di = 0;
      function stepDept() {
        if (halted()) return;
        if (di >= deptList.length) { finish(); return; }
        var d = deptList[di++];
        setSub("Department " + di + " / " + deptList.length + "  ·  " + d.label);
        setBar(0.05 + 0.9 * (di / deptList.length));
        cpUxpReportFetch(d.value).then(function (res) {
          if (halted()) return;
          if (res && res.auth === false) { fail("Session bounce fetching “" + d.label + "” — please sign in again, then retry."); return; }
          absorb(res, d.label);
          setN();
          stepDept();
        }).catch(function (e) { if (!halted()) fail("Report for “" + d.label + "” failed (" + String((e && e.message) || e) + ")."); });
      }
      function runBroad() {
        setH("Fetching the directory…"); setBar(0.4);
        cpUxpReportFetch(null).then(function (res) {
          if (halted()) return;
          if (res && res.auth === false) { fail("Session bounce fetching the directory — please sign in again, then retry."); return; }
          absorb(res, "all");
          setN();
          if (built === null && acc.rows.length >= CP_UXP_CAPWARN) addWarn("The broad report returned " + acc.rows.length.toLocaleString() + " rows — if the group is very large, run it on a page that has departments.");
          finish();
        }).catch(function (e) { if (!halted()) fail("Directory report failed (" + String((e && e.message) || e) + ")."); });
      }
      startBtn.addEventListener("click", function () {
        var r = back.querySelector('input[name="cp-uxp-mode"]:checked');
        mode = r ? r.value : "users";
        back.querySelector(".cp-uxp-opts").classList.add("cp-uxp-hide");
        startBtn.classList.add("cp-uxp-hide");
        [".cp-uxp-anim", ".cp-uxp-barwrap", ".cp-uxp-n", ".cp-uxp-sub", ".cp-uxp-note"].forEach(function (s) { var el2 = back.querySelector(s); if (el2) el2.classList.remove("cp-uxp-hide"); });
        try { if (lensEl && lensEl.animate) lensEl.animate([{ transform: "scale(1)" }, { transform: "scale(1.09)" }, { transform: "scale(1)" }], { duration: 1700, iterations: Infinity, easing: "ease-in-out" }); } catch (e) {}
        setH("Reading the department list…"); setBar(0.03);
        // Enumerate departments (composite-keyed) from the live search form, then report per department.
        var deptFieldVal = deptField ? deptField.value : null;
        var meta = deptFieldVal ? cpResolveFieldMeta(deptFieldVal) : null;
        deptList = (meta && meta.options ? meta.options : []).filter(function (o) { return String(o.value) !== ""; });
        if (deptList.length) { setH("Fetching the directory, department by department…"); stepDept(); }
        else runBroad();
      });
    }

    // ---- Center-modal Add (Option A, user-picked 2026-07-04). pjax owns the HOST: fetch the Add form in
    // the background (token threaded, same engine as cpLeafSave), mount its raw markup (kept hidden by CSS)
    // inside the modal, let skin.js dress it (cp:modalform → cp-prof rows + Add/Cancel), background-POST on
    // cp:modalsubmit, close + refresh the grid in place on success, surface the server's message on failure.
    // skin.js answers cp:modalform-fail when it has no config for the fetched form → fall back to the normal
    // page navigation, so un-skinned Add forms keep working. Pilot: SP Schedules Add.
    var cpModalEl = null, cpModalCtx = null;
    function cpModalClose() {
      document.removeEventListener("keydown", cpModalKey, true);
      if (cpModalEl) { try { cpModalEl.remove(); } catch (e) {} }
      cpModalEl = null; cpModalCtx = null;
    }
    function cpModalKey(e) { if (e.key === "Escape") { e.stopPropagation(); cpModalClose(); } }
    function cpModalTokenSync(doc) {
      var nt = doc && doc.getElementsByName("formtokenserial")[0];
      if (nt) { var ts = document.getElementsByName("formtokenserial"); for (var i = 0; i < ts.length; i++) ts[i].value = nt.value; }
    }
    // ---- Schedule EVENTS popup (user re-scope 2026-07-06: the Schedule Modify PAGE is defunct) ----
    // The Schedules LIST stays the only real page. Drilling a schedule still swaps to Schedule Modify
    // (so the proven grid/preload/add/delete machinery builds underneath), but that page is presented
    // AS this popup: event rows (click = edit in the center modal), a per-row delete (the grid's
    // confirm + commit), and Add event (the grid's own Add route). After any add/edit/delete the ok
    // response re-enters the page → the grid rebuilds → the popup re-opens with fresh data. Closing
    // (✕/Esc/backdrop) leaves the defunct page too — back to the Schedules list.
    var cpPickEl = null;
    function cpPickClose() {
      if (!cpPickEl) return;
      try { cpPickEl.remove(); } catch (e) {}
      cpPickEl = null;
      document.removeEventListener("keydown", cpPickKey, true);
    }
    function cpPickCloseBack() {
      if (!cpPickEl) return;
      cpPickClose();
      // Only NAVIGATE when the popup was covering the defunct Schedule Modify page (the on-page
      // fallback path); the background popup floats over the Schedules LIST — closing just closes.
      var p = document.documentElement.getAttribute("data-cp-path") || location.pathname;
      if (/\/Schedules\/Modify\//.test(p)) { try { cpHook(p.replace(/Modify\/(index\.jsp)?$/, ""), {}); } catch (e) {} }
    }
    function cpPickKey(e) { if (e.key === "Escape") { e.stopPropagation(); cpPickCloseBack(); } }
    function cpEventsPopup(state) {
      if (cpPickEl || cpModalEl) return;
      var mf = document.querySelector('form[name="mainForm"]');
      var schedName = "", schedType = "";
      try {
        schedName = (mf && mf.elements.scheduleName && mf.elements.scheduleName.value) || (mf && mf.elements.key && mf.elements.key.value) || "Schedule";
        schedType = (mf && mf.elements.name && mf.elements.name.value) || "";   // name/P_name carry the TYPE (key/P_key the schedule)
      } catch (e) {}
      var back = document.createElement("div"); back.className = "cp-modal-back";
      var card = document.createElement("div"); card.className = "cp-modal cp-modal-pick";
      var head = document.createElement("div"); head.className = "cp-modal-head";
      head.innerHTML = '<span class="cp-modal-headico">' + (cpHeaderIcon("Schedules") || "") + '</span>' +
        '<span>' + cpEsc(schedName) + '</span>' +
        (schedType ? '<span class="cp-pick-pill">' + cpEsc(schedType) + '</span>' : '');
      var x = document.createElement("button");
      x.type = "button"; x.className = "cp-modal-x"; x.setAttribute("aria-label", "Close");
      x.innerHTML = CP_SVG_X;
      x.addEventListener("click", cpPickCloseBack);
      head.appendChild(x);
      card.appendChild(head);
      var list = document.createElement("div"); list.className = "cp-pick-list";
      if (!state.all.length) {
        var empty = document.createElement("div"); empty.className = "cp-pick-empty";
        empty.textContent = "No events yet — add the first one below.";
        list.appendChild(empty);
      }
      state.all.forEach(function (r) {
        var key = cpGridRowKey(state, r);
        var row = document.createElement("button"); row.type = "button"; row.className = "cp-pick-row";
        row.innerHTML = '<span class="cp-pick-name">' + cpEsc(r.cells[0] || "") + '</span>';
        if (state.delEnabled && Object.prototype.hasOwnProperty.call(state.delMap, key)) {
          var del = document.createElement("span"); del.className = "cp-pick-del";
          del.setAttribute("role", "button"); del.setAttribute("aria-label", "Delete " + (r.cells[0] || ""));
          del.innerHTML = CP_SVG_TRASH;
          del.addEventListener("click", function (e) {
            e.stopPropagation();
            state.delSel = {}; state.delSel[key] = true;
            cpGridOpenDelConfirm(state);   // stacks above (later in DOM); Delete commits via the grid's Apply path
          });
          row.appendChild(del);
        }
        var chev = document.createElement("span"); chev.className = "cp-pick-chev"; chev.innerHTML = CP_SVG_CHEVRIGHT;
        row.appendChild(chev);
        row.addEventListener("click", function () {
          cpPickClose();   // plain close (stay on the page) — the edit modal takes over
          if (!r.drill) return;
          var mu = r.drill.url || "";
          try { mu = new URL(mu, location.href).pathname; } catch (e) {}
          cpModalAdd(state, mu, r.drill.params || {});
        });
        list.appendChild(row);
      });
      card.appendChild(list);
      var foot = document.createElement("div"); foot.className = "cp-modal-foot cp-pick-foot";
      var addB = document.createElement("button"); addB.type = "button"; addB.className = "cp-prof-btn cp-prof-primary";
      addB.innerHTML = CP_SVG_PLUS + "<span>Add event</span>";
      addB.addEventListener("click", function () {
        cpPickClose();
        var real = state.wrap && state.wrap.querySelector(".cp-srch-actbtn");
        if (real) real.click();
      });
      foot.appendChild(addB);
      card.appendChild(foot);
      back.appendChild(card);
      back.addEventListener("mousedown", function (e) { if (e.target === back) cpPickCloseBack(); });
      document.addEventListener("keydown", cpPickKey, true);
      document.body.appendChild(back);
      cpPickEl = back;
    }
    // ---- BACKGROUND events popup (user follow-up 2026-07-06: never even navigate to Schedule
    // Modify). Clicking a schedule row on the Schedules LIST fetches its Modify page in the BACKGROUND
    // (the events table is server-rendered in the response — live-probed with zzCpProbeEvt: tr#Row1 in
    // the raw HTML) and shows the popup right over the list, which never swaps out. Add/edit run the
    // center form modal with an onDone that re-fetches this popup; delete replays the fetched
    // mainForm + the row's checkbox + Apply. If the background fetch fails, fall back to the real
    // navigation (the on-page popup above takes over there).
    var cpPickReopen = null;   // re-open callback armed while a form modal is up (consumed on cancel)
    function cpEventsPopupBg(state, listRow) {
      if (cpPickEl || cpModalEl) return;
      cpPickReopen = null;
      var schedName = listRow.cells[0] || "Schedule", schedType = listRow.cells[1] || "";
      var mu = (listRow.drill && listRow.drill.url) || "Modify/index.jsp";
      try { mu = new URL(mu, location.href).pathname; } catch (e) {}
      var mp = (listRow.drill && listRow.drill.params) || {};
      var back = document.createElement("div"); back.className = "cp-modal-back";
      var card = document.createElement("div"); card.className = "cp-modal cp-modal-pick";
      var head = document.createElement("div"); head.className = "cp-modal-head";
      head.innerHTML = '<span class="cp-modal-headico">' + (cpHeaderIcon("Schedules") || "") + '</span>' +
        '<span>' + cpEsc(schedName) + '</span>' +
        (schedType ? '<span class="cp-pick-pill">' + cpEsc(schedType) + '</span>' : '');
      var x = document.createElement("button");
      x.type = "button"; x.className = "cp-modal-x"; x.setAttribute("aria-label", "Close");
      x.innerHTML = CP_SVG_X;
      x.addEventListener("click", cpPickCloseBack);
      head.appendChild(x);
      card.appendChild(head);
      var list = document.createElement("div"); list.className = "cp-pick-list";
      list.innerHTML = '<div class="cp-pick-empty">Loading…</div>';
      card.appendChild(list);
      var foot = document.createElement("div"); foot.className = "cp-modal-foot cp-pick-foot";
      var addB = document.createElement("button"); addB.type = "button"; addB.className = "cp-prof-btn cp-prof-primary";
      addB.innerHTML = CP_SVG_PLUS + "<span>Add event</span>";
      addB.disabled = true;
      foot.appendChild(addB);
      card.appendChild(foot);
      back.appendChild(card);
      back.addEventListener("mousedown", function (e) { if (e.target === back) cpPickCloseBack(); });
      document.addEventListener("keydown", cpPickKey, true);
      document.body.appendChild(back);
      cpPickEl = back;

      var tokEl = document.getElementsByName("formtokenserial")[0];
      cpFollow(mu, mp, tokEl ? tokEl.value : null, 0).then(function (res) {
        if (cpPickEl !== back) return;   // closed / superseded while loading
        if (!res || res.auth === false || res.err || !res.doc) {
          cpPickClose();
          if (listRow.drill && typeof window.redirectPost === "function") window.redirectPost(listRow.drill.url, listRow.drill.params);
          return;
        }
        cpModalTokenSync(res.doc);   // the fetch rotated the single-use token — write the fresh one back
        var rows = cpSearchParseRows(res.doc);
        var delKeys = {};
        [].forEach.call(res.doc.querySelectorAll('input[type="checkbox"][name^="checkbox_"], input[type="checkbox"][name*="__DELIMITER__"]'), function (cb) {
          var k = cpGridDelKey(null, cb);
          if (k) delKeys[k] = 1;
        });
        var reopen = function () { cpPickClose(); cpEventsPopupBg(state, listRow); };
        list.innerHTML = "";
        if (!rows.length) {
          var empty = document.createElement("div"); empty.className = "cp-pick-empty";
          empty.textContent = "No events yet — add the first one below.";
          list.appendChild(empty);
        }
        rows.forEach(function (r) {
          var key = r.cells[0] || "";
          var row = document.createElement("button"); row.type = "button"; row.className = "cp-pick-row";
          row.innerHTML = '<span class="cp-pick-name">' + cpEsc(key) + '</span>';
          if (Object.prototype.hasOwnProperty.call(delKeys, key)) {
            var del = document.createElement("span"); del.className = "cp-pick-del";
            del.setAttribute("role", "button"); del.setAttribute("aria-label", "Delete " + key);
            del.innerHTML = CP_SVG_TRASH;
            del.addEventListener("click", function (e) {
              e.stopPropagation();
              cpPickConfirmDelete(key, function () { cpPickCommitDeleteBg(res.doc, mu, key, reopen); });
            });
            row.appendChild(del);
          }
          var chev = document.createElement("span"); chev.className = "cp-pick-chev"; chev.innerHTML = CP_SVG_CHEVRIGHT;
          row.appendChild(chev);
          row.addEventListener("click", function () {
            if (!r.drill) return;
            var eu = r.drill.url || "";
            try { eu = new URL(eu, location.origin + mu).pathname; } catch (e) {}   // row drills are relative to the MODIFY page
            cpPickReopen = reopen;
            cpPickClose();
            cpModalAdd(state, eu, r.drill.params || {}, reopen);
          });
          list.appendChild(row);
        });
        addB.disabled = false;
        addB.addEventListener("click", function () {
          var au = mu.replace(/Modify\/(index\.jsp)?$/, "Events/Add/index.jsp");
          cpPickReopen = reopen;
          cpPickClose();
          cpModalAdd(state, au, mp, reopen);   // the Add form's context = the schedule drill params (live-proven)
        });
      }).catch(function () { cpPickClose(); });
    }
    // Single-event confirm (same look as the grid's delete modal, popup-local commit).
    function cpPickConfirmDelete(name, onGo) {
      var ov = document.createElement("div");
      ov.className = "cp-srch-delmodal-ov";
      ov.innerHTML =
        '<div class="cp-srch-delmodal" role="dialog" aria-modal="true" aria-label="Confirm delete">' +
          '<div class="cp-srch-delmodal-ico">' + CP_SVG_TRASH + '</div>' +
          '<div class="cp-srch-delmodal-tt">Delete this event?</div>' +
          '<div class="cp-srch-delmodal-sub">This permanently removes it and can’t be undone.</div>' +
          '<div class="cp-srch-delmodal-names"><span>' + cpEsc(name) + '</span></div>' +
          '<div class="cp-srch-delmodal-acts">' +
            '<button type="button" class="cp-srch-delmodal-cancel">Cancel</button>' +
            '<button type="button" class="cp-srch-delmodal-go">' + CP_SVG_TRASH + '<span>Delete</span></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
      ov.querySelector(".cp-srch-delmodal-cancel").addEventListener("click", close);
      ov.querySelector(".cp-srch-delmodal-go").addEventListener("click", function () { close(); onGo(); });
    }
    // Replays the legacy delete WITHOUT the page: the fetched Modify page's mainForm fields + the
    // row's delete checkbox + Apply, POSTed with the LIVE token (cpModalTokenSync already wrote the
    // fetched doc's rotated token into the page).
    function cpPickCommitDeleteBg(doc, mu, key, done) {
      var params = {};
      [].forEach.call(doc.querySelectorAll('form[name="mainForm"] input, form[name="mainForm"] select, form[name="mainForm"] textarea'), function (el) {
        if (!el.name || el.name === "formtokenserial") return;
        var t = (el.type || "").toLowerCase();
        if (t === "submit" || t === "button" || t === "image") return;
        if ((t === "checkbox" || t === "radio") && !el.checked) return;
        params[el.name] = el.value || "";
      });
      var cb = null;
      [].forEach.call(doc.querySelectorAll('input[type="checkbox"][name^="checkbox_"], input[type="checkbox"][name*="__DELIMITER__"]'), function (el) {
        if (cpGridDelKey(null, el) === key) cb = el;
      });
      if (!cb) return;
      params[cb.name] = cb.value || "on";
      params.apply = "Apply";
      var tokEl = document.getElementsByName("formtokenserial")[0];
      cpFollow(mu, params, tokEl ? tokEl.value : null, 0).then(function (res) {
        if (res && res.doc) cpModalTokenSync(res.doc);
        if (done) { try { done(); } catch (e) {} }
      });
    }
    // Dial Plan Policy access-code modals: the skin's codes card writes the target on <html>
    // data-cp-dpp-* attributes and fires this event (CustomEvent detail doesn't cross the
    // isolated→MAIN world boundary; DOM attributes do). Opens the same center modal as grid Adds —
    // the ok success re-enters the hosting page via listNav, re-rendering the card with fresh rows.
    document.addEventListener("cp:dppmodal", function () {
      var root = document.documentElement;
      var u = root.getAttribute("data-cp-dpp-url");
      var p = {};
      try { p = JSON.parse(root.getAttribute("data-cp-dpp-params") || "{}"); } catch (e) {}
      root.removeAttribute("data-cp-dpp-url"); root.removeAttribute("data-cp-dpp-params");
      if (!u) return;
      try { u = new URL(u, location.href).pathname; } catch (e) {}
      cpModalAdd(null, u, p);
    });
    // Generic FULL-PAGE nav bridge (same attribute mechanism as cp:dppmodal, but rides cpHook
    // instead of the modal — for skin-built buttons whose target is a whole page, e.g. the Dialable
    // Caller ID criteria Add/Edit; the legacy buttons' own DCL wiring dies after an in-shell swap).
    document.addEventListener("cp:cpnav", function () {
      var root = document.documentElement;
      var u = root.getAttribute("data-cp-nav-url");
      var p = {};
      try { p = JSON.parse(root.getAttribute("data-cp-nav-params") || "{}"); } catch (e) {}
      root.removeAttribute("data-cp-nav-url"); root.removeAttribute("data-cp-nav-params");
      if (!u) return;
      window.redirectPost(u, p);
    });
    // A navigation swap must never strand the popup over the NEXT page.
    document.addEventListener("cp:reskin", function () { cpPickReopen = null; cpPickClose(); });
    // A form modal dismissed with Cancel/✕ brings the events popup back: the background popup via its
    // armed reopen callback; the on-page fallback via the grid state. (setTimeout: the other
    // cp:modalcancel listener, cpModalClose, must run first so cpModalEl clears.)
    document.addEventListener("cp:modalcancel", function () {
      setTimeout(function () {
        if (cpModalEl || cpPickEl) return;
        if (cpPickReopen) { var f = cpPickReopen; cpPickReopen = null; try { f(); } catch (e) {} return; }
        if (cpGridState && cpGridState.pickerAuto && document.contains(cpGridState.wrap)) cpEventsPopup(cpGridState);
      }, 0);
    });

    function cpModalAdd(state, url, params, onDone) {
      if (cpModalEl) return;
      // listNav = the nav that ENTERED the hosting page, params included. The old data-cp-path string was
      // enough for plain lists, but a Modify-hosted grid (Schedule Modify's events) needs the entity params
      // (name/P_name/key/P_key) to re-enter — a bare POST to the Modify URL has no target schedule.
      // onDone (optional): success callback that REPLACES the list re-entry — the background events
      // popup refreshes itself instead of navigating.
      cpModalCtx = { url: url, params: params || {}, state: state, onDone: onDone || null,
                     listNav: cpLastNav ? { url: cpLastNav.url, params: cpLastNav.params || {} } : null,
                     listUrl: document.documentElement.getAttribute("data-cp-path") || location.pathname };
      cpModalEl = document.createElement("div");
      cpModalEl.className = "cp-modal-back";
      var card = document.createElement("div"); card.className = "cp-modal";
      var load = document.createElement("div"); load.className = "cp-modal-load"; load.textContent = "Loading…";
      var body = document.createElement("div"); body.className = "cp-modal-body";
      card.appendChild(load); card.appendChild(body);
      cpModalEl.appendChild(card);
      cpModalEl.addEventListener("mousedown", function (e) { if (e.target === cpModalEl) cpModalClose(); });
      document.addEventListener("keydown", cpModalKey, true);
      document.body.appendChild(cpModalEl);
      var tokEl = document.getElementsByName("formtokenserial")[0];
      cpFollow(url, params || {}, tokEl ? tokEl.value : null, 0).then(function (res) {
        if (!cpModalEl) return;   // user closed while loading
        if (!res || res.auth === false || res.err || !res.doc) { cpModalClose(); cpHook(url, params || {}); return; }
        cpModalTokenSync(res.doc);
        var cell = res.doc.querySelector("td.enduserbody") || res.doc.querySelector('td[width="82%"]');
        if (!cell) { cpModalClose(); cpHook(url, params || {}); return; }
        body.innerHTML = cell.innerHTML;
        // Entity-CONTEXT hiddens (name/P_name/key/P_key…) sit in mainForm OUTSIDE the content cell, so the
        // cell mount drops them and the ok POST loses its target (harmless for session-scoped Adds like
        // Schedules; an Events Add needs its schedule). Copy them into the hidden body for serialization.
        [].forEach.call(res.doc.querySelectorAll('input[type="hidden"]'), function (h) {
          if (!h.name || h.name === "formtokenserial") return;
          if (cell.contains(h)) return;                              // already in the mounted markup
          if (body.querySelector('[name="' + h.name + '"]')) return; // dedupe (buttonClicked appears twice)
          var c = document.createElement("input");
          c.type = "hidden"; c.name = h.name; c.value = h.value;
          body.appendChild(c);
        });
        try { load.remove(); } catch (e) {}
        document.dispatchEvent(new CustomEvent("cp:modalform"));
      }).catch(function () { cpModalClose(); });
    }
    document.addEventListener("cp:modalcancel", cpModalClose);
    document.addEventListener("cp:modalform-fail", function () {
      if (!cpModalCtx) return;
      var u = cpModalCtx.url, p = cpModalCtx.params;
      cpModalClose();
      cpHook(u, p);
    });
    document.addEventListener("cp:modalsubmit", function () {
      if (!cpModalEl || !cpModalCtx) return;
      // Serialize from the MODAL ROOT: the skinner MOVES text inputs/selects into its rows while the
      // forward-clicked radios/checkboxes stay in the hidden raw body — both live under cpModalEl.
      var params = {};
      [].forEach.call(cpModalEl.querySelectorAll("input, select, textarea"), function (el) {
        if (!el.name || el.name === "formtokenserial") return;
        var t = (el.type || "").toLowerCase();
        if (t === "submit" || t === "button" || t === "image") return;
        if ((t === "checkbox" || t === "radio") && !el.checked) return;
        params[el.name] = el.value || "";
      });
      var okEl = cpModalEl.querySelector('input[name="ok"]');
      params.ok = okEl ? (okEl.value || "OK") : "OK";
      // Signature field = the form's first visible named input (eventName / scheduleName…). Its reappearance
      // in the response cell means the server re-rendered THIS form (= rejection) — needed because the Event
      // family keeps ok/cancel OUTSIDE td.enduserbody, so the formAgain probe alone misses the re-render and
      // a silent rejection read as success (live-diagnosed 2026-07-06: Error 4195 swallowed, "add adds nothing").
      var sigEl = cpModalEl.querySelector('input[name][type="text"], input[name]:not([type]), textarea[name]');
      var sigName = sigEl ? sigEl.name : null;
      var tokEl = document.getElementsByName("formtokenserial")[0];
      cpFollow(cpModalCtx.url, params, tokEl ? tokEl.value : null, 0).then(function (res) {
        if (!cpModalEl) return;
        var doc = res && res.doc;
        if (doc) cpModalTokenSync(doc);
        // Success ⇒ the server did NOT re-render the same form (a good add answers with a stub that
        // cpFollow follows to the fresh LIST page; a validation failure re-renders the form + an inline
        // <td.error><span.Failure> message). NB do NOT probe for an ok button here: the stub-followed
        // success landing (e.g. Schedule Modify hosting the events grid) has its OWN ok — the signature
        // field is the re-render tell.
        var cell = doc && (doc.querySelector("td.enduserbody") || doc.querySelector('td[width="82%"]'));
        var failSpan = doc && doc.querySelector("span.Failure, td.error");
        var sigAgain = sigName && cell && cell.querySelector('[name="' + sigName + '"]');
        var failed = !!(res && res.err) || (res && res.auth === false) || !doc || !!failSpan || !!sigAgain;
        if (!failed) {
          // Re-ENTER the list rather than re-running the search: BroadWorks keeps a session-scoped result
          // model built at list ENTRY, and find/findAll serve THAT — after a background add even Find All
          // returns the stale model until the list is re-entered (user repro: test/test2 schedules absent
          // until leaving + returning). The legacy flow never showed this because OK's response is itself
          // a fresh list entry — mirror it with a bare in-shell re-entry of the list page.
          var ln = cpModalCtx.listNav, lu = cpModalCtx.listUrl, od = cpModalCtx.onDone;
          cpModalClose();
          // A background-popup modal refreshes ITS caller instead of re-entering the list.
          if (od) { try { od(); } catch (e) {} return; }
          // Prefer the full entry nav (params restore a Modify-hosted grid's entity context);
          // the bare listUrl stays as the fallback for the plain-list case.
          try { if (ln) cpHook(ln.url, ln.params); else if (lu) cpHook(lu, {}); } catch (e) {}
          return;
        }
        var msg = "The server didn't accept that — check the fields and try again.";
        if (res && res.auth === false) msg = "Your session has expired — please sign in and try again.";
        else try {
          // Prefer the server's own failure line ("Failed to add: Error 4195 The start date and time …").
          var ft = failSpan ? (failSpan.textContent || "").replace(/\s+/g, " ").trim() : "";
          if (ft) msg = ft.slice(0, 180);
          else {
            var mtx = (cell ? cell.textContent : "").replace(/\s+/g, " ");
            var em = /Error\s*\d+[^.!]*[.!]?/.exec(mtx);
            if (em) msg = em[0].trim();
          }
        } catch (e) {}
        cpModalEl.setAttribute("data-cp-err", msg);
        document.dispatchEvent(new CustomEvent("cp:modalerror"));
      });
    });
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
        var tgt = cpGridActionTarget(a.el);   // read at build (the legacy element + its inline script are live in the hidden markup)
        var exp = tgt ? null : cpGridExportTarget(a.el);   // Export = exportComponent(...), not a redirectPost
        btn.addEventListener("click", function () {
          // Prefer the extracted target (reliable in-shell). The relative url is resolved by cpHook at click time
          // (against the list landing / cpSearchLanding). Export downloads via blob. Fall back to forwarding the
          // real click for any button whose handler isn't a redirectPost (e.g. a true submit).
          // Add actions open the CENTER MODAL instead of navigating (skin falls back to nav when it can't
          // skin the fetched form). Import stays a page (file upload needs a native submit).
          if (tgt && /(^|\/)Add\/(index\.jsp)?$/.test(tgt.url)) {
            var mu = tgt.url.charAt(0) === "/" ? tgt.url
              : ((cpSearchLanding || location.pathname).replace(/[^/]*$/, "") + tgt.url);
            // Normalize ".." segments (Schedule Modify's Add is "../Events/Add/index.jsp") — fetch would
            // resolve them anyway, but the modal-fail fallback runs the string through isPjaxUrl, which
            // only matches the CANONICAL path.
            try { mu = new URL(mu, location.origin).pathname; } catch (e) {}
            cpModalAdd(state, mu, tgt.params);
          }
          else if (tgt && typeof window.redirectPost === "function") window.redirectPost(tgt.url, tgt.params);
          else if (exp) cpExportComponent(exp.component, exp.contextPath, exp.pagePath, exp.tokenName);
          else { try { a.el.click(); } catch (e) {} }
        });
        host.appendChild(btn);
      });
      // Export (0.2.344): Group Directory ONLY — the full-data export is sourced from that page's Detail
      // report (ClientBGListServlet + bglist_detail.xsl), run per department. Not meaningful on other lists.
      if (/\/Group\/CompanyDir\//.test(location.pathname) && document.getElementById("searchTable")) {
        var xb = document.createElement("button");
        xb.type = "button";
        xb.className = "cp-srch-actbtn sec cp-uxp-open";
        xb.title = "Download the full group directory (two Excel files, zipped) — full emails, by department";
        xb.innerHTML = CP_SVG_DL + "<span>Export</span>";
        xb.addEventListener("click", function () { cpExportUsers(state); });
        host.appendChild(xb);
      }
    }
    // MULTI-SELECT DELETE (Option B, user-picked 2026-06-26). BroadSoft list pages with a delete column expose a
    // hidden per-row checkbox `checkbox_…__DELIMITER__<rowKey>` — present ONLY for deletable rows (e.g. reseller-
    // level Tag Sets; System rows have none) — plus `apply`/`ok` submit buttons. Legacy flow = tick boxes, press
    // Apply. We surface a grid checkbox in the id cell for the deletable rows, a floating action bar when ≥1 is
    // selected, and ONE confirm modal; committing checks the matching legacy boxes and clicks Apply (a real
    // type=submit in mainForm → fires the submit event → rides pjax in-shell, same path as the Add/Import buttons).
    // See [[project-search-redesign]], [[feedback-everything-through-pjax]].
    // Two legacy delete-checkbox namings: `checkbox_<colUuid>__DELIMITER__<rowKey>` (Tag Sets…) and the bare
    // `checkbox_<rowKey>` (Schedule Modify's EVENTS list). The bare form is accepted ONLY under a "Delete"
    // column header — other lists use bare checkbox_ columns for state (Xsi "Default") and must never grow
    // delete UI ([[gotcha-tab-dialects-and-sbx-landmines]]).
    function cpGridDelKey(state, cb) {
      var n = cb.name || "";
      if (n.indexOf("__DELIMITER__") !== -1) return n.split("__DELIMITER__")[1] || "";
      if (n.indexOf("checkbox_") === 0) {
        var td = cb.closest("td"), tbl = cb.closest("table");
        var hd = td && tbl && tbl.rows.length ? tbl.rows[0].cells[td.cellIndex] : null;
        if (hd && /^\s*delete\s*$/i.test(hd.textContent || "")) return n.slice("checkbox_".length);
      }
      return "";
    }
    function cpGridSetupDelete(state) {
      state.delMap = {}; state.delSel = {}; state.delEnabled = false; state.delBtn = null;
      try {
        var boxes = state.cell.querySelectorAll('input[type="checkbox"][name*="__DELIMITER__"], input[type="checkbox"][name^="checkbox_"]');
        [].forEach.call(boxes, function (cb) {
          var key = cpGridDelKey(state, cb);
          if (key) state.delMap[key] = 1;   // presence ⇒ this row key is deletable (value unused)
        });
        state.delBtn = state.cell.querySelector('input[name="apply"]') ? "apply"
                     : (state.cell.querySelector('input[name="ok"]') ? "ok" : null);
        state.delEnabled = Object.keys(state.delMap).length > 0 && !!state.delBtn;
      } catch (e) { state.delEnabled = false; }
    }
    function cpGridSelCount(state) {
      return state.delSel ? Object.keys(state.delSel).filter(function (k) { return state.delSel[k]; }).length : 0;
    }
    function cpGridToggleSel(state, name) {
      if (!name) return;
      state.delSel[name] = !state.delSel[name];
      var esc = (window.CSS && CSS.escape) ? CSS.escape(name) : name;
      [].forEach.call(state.wrap.querySelectorAll('.cp-srch-selbox[data-name="' + esc + '"]'), function (b) {
        var on = !!state.delSel[name];
        b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
      });
      cpGridSyncHeaderDel(state);
      cpGridUpdateDelBar(state);
    }
    function cpGridClearSel(state) {
      state.delSel = {};
      [].forEach.call(state.wrap.querySelectorAll(".cp-srch-selbox.on"), function (b) { b.classList.remove("on"); b.setAttribute("aria-checked", "false"); });
      cpGridSyncHeaderDel(state);
      cpGridUpdateDelBar(state);
    }
    function cpGridUpdateDelBar(state) {
      var bar = state.wrap.querySelector(".cp-srch-delbar");
      if (!bar) return;
      var n = cpGridSelCount(state);
      bar.classList.toggle("show", n > 0);
      var c = bar.querySelector(".cp-srch-delcount");
      if (c) c.textContent = n + " selected";
    }
    function cpGridOpenDelConfirm(state) {
      var names = Object.keys(state.delSel || {}).filter(function (k) { return state.delSel[k]; });
      if (!names.length) return;
      var one = names.length === 1;
      var ov = document.createElement("div");
      ov.className = "cp-srch-delmodal-ov";
      ov.innerHTML =
        '<div class="cp-srch-delmodal" role="dialog" aria-modal="true" aria-label="Confirm delete">' +
          '<div class="cp-srch-delmodal-ico">' + CP_SVG_TRASH + '</div>' +
          '<div class="cp-srch-delmodal-tt">' + (one ? "Delete this entry?" : "Delete " + names.length + " entries?") + '</div>' +
          '<div class="cp-srch-delmodal-sub">This permanently removes ' + (one ? "it" : "them") + ' and can’t be undone.</div>' +
          '<div class="cp-srch-delmodal-names">' + names.map(function (n) { return '<span>' + cpEsc(n) + '</span>'; }).join("") + '</div>' +
          '<div class="cp-srch-delmodal-acts">' +
            '<button type="button" class="cp-srch-delmodal-cancel">Cancel</button>' +
            '<button type="button" class="cp-srch-delmodal-go">' + CP_SVG_TRASH + '<span>Delete</span></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener("keydown", onKey); }
      function onKey(e) { if (e.key === "Escape") close(); }
      document.addEventListener("keydown", onKey);
      ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
      ov.querySelector(".cp-srch-delmodal-cancel").addEventListener("click", close);
      ov.querySelector(".cp-srch-delmodal-go").addEventListener("click", function () { close(); cpGridCommitDelete(state); });
      try { ov.querySelector(".cp-srch-delmodal-go").focus(); } catch (e) {}
    }
    function cpGridCommitDelete(state) {
      try {
        var sel = state.delSel || {}, any = false;
        var boxes = state.cell.querySelectorAll('input[type="checkbox"][name*="__DELIMITER__"], input[type="checkbox"][name^="checkbox_"]');
        [].forEach.call(boxes, function (cb) {
          var key = cpGridDelKey(state, cb);
          if (!key || !Object.prototype.hasOwnProperty.call(state.delMap, key)) return;   // not a delete box — don't touch
          cb.checked = !!sel[key];
          if (cb.checked) any = true;
        });
        if (!any) return;
        // Apply/OK are real type=submit inside mainForm → .click() fires the submit event → pjax intercepts and
        // posts the form (boxes now checked) in-shell; the server deletes and returns the refreshed list, which
        // rebuilds the grid fresh (the old state + selection are discarded). Never POST empty context (no boxes).
        var btn = state.cell.querySelector('input[name="' + state.delBtn + '"]');
        if (btn) btn.click();
      } catch (e) { console.warn("[pjax] cpGridCommitDelete:", e); }
    }
    // Row key = the id-column value (the tag-set name the legacy delete checkbox is keyed on).
    function cpGridRowKey(state, row) {
      var idIdx = 0;
      for (var i = 0; i < state.cols.length; i++) { if (state.cols[i].type === "id") { idIdx = state.cols[i].idx; break; } }
      return row.cells[idIdx] == null ? "" : row.cells[idIdx];
    }
    // The select-column cell for a row: a checkbox for deletable rows, an empty cell otherwise (its own column).
    function cpGridSelCellHTML(state, row) {
      var v = cpGridRowKey(state, row);
      if (Object.prototype.hasOwnProperty.call(state.delMap, v)) {
        var on = state.delSel[v] ? " on" : "";
        return '<div class="cp-srch-td cp-srch-selcell"><span class="cp-srch-selbox' + on + '" data-name="' + cpEsc(v) + '" role="checkbox" aria-checked="' + (state.delSel[v] ? "true" : "false") + '" aria-label="Select ' + cpEsc(v) + '">' + CP_SVG_CHECK + '</span></div>';
      }
      return '<div class="cp-srch-td cp-srch-selcell"></div>';
    }
    // Sync the header trash button's hot (red, clickable) state with the live selection count (Option B).
    function cpGridSyncHeaderDel(state) {
      var d = state.wrap && state.wrap.querySelector(".cp-srch-selhdr-del");
      if (d) d.classList.toggle("hot", cpGridSelCount(state) > 0);
    }
    // Tabbed sub-pages + editable rename, surfaced ABOVE the filter bar. Generic over the legacy BroadSoft tab
    // markup: `.tabActive` = the current tab, `a.tab` = links to sibling sub-pages (their click is DOMContentLoaded-
    // wired to redirectPost the sibling URL, which rides pjax via the Operator/System Modify rule). The rename field
    // surfaces the real `newTagSetName` input (MOVED into the visible row so it still submits inside mainForm) with a
    // Save that forwards to the legacy Apply. Only renders on pages that actually expose tabs / that input.
    // Replay a legacy tab switch THROUGH pjax (the whole-app goal — see [[feedback-everything-through-pjax]]).
    // The legacy handler is TabSubmit(url): it sets mainForm.tabPage = url then form.submit() — a NATIVE submit
    // that bypasses pjax's submit-event interceptor (→ full reload). Instead we read the target url from the tab's
    // own inline TabSubmit('…') (its DOMContentLoaded-wired handler isn't attached after an in-shell swap, so a
    // forwarded .click() does nothing), collect the LIVE mainForm fields, set tabPage, drop the single-use token
    // (cpHook threads the live one), and redirectPost the CURRENT url (mainForm has no action → posts to self) so it
    // rides cpFollow in-shell. The full form context is REQUIRED — a bare/empty POST 500s + logs the user out.
    function cpTabNav(tabEl) {
      try {
        var form = document.querySelector('form[name="mainForm"]');
        if (!form) return false;
        // Deliberately DON'T call the legacy validate(form) here. TabSubmit gates the switch on full-form validity,
        // which FAILS on the Regions sub-page (its form lacks the fields validate expects) → switching back to Tags
        // was silently blocked (the asymmetry: Tags→Regions validated fine, Regions→Tags didn't). A tab switch is
        // navigation, not a save, so it must not be validation-gated.
        // TWO legacy tab dialects (both wired by uuid addEventListener scripts, inline onclick is CSP-stripped):
        //  - "TabSubmit('<url>')" (capital T — TagSets/Regions): replay must post to the TAB's OWN url so location
        //    lands on the tab's real page (0.2.253 — relative Add buttons resolve against it).
        //  - "tabSubmit('<rel>')" (lowercase t, Scripts/tabSubmit.js — Xsi Policy Profile): the native handler sets
        //    mainForm.tabPage=<rel> and form.submit()s to SELF; the SERVER switches the tab (location stays on the
        //    entry URL). Replay = POST {tabPage} ONLY to the CURRENT url (verified live on apps01: SP→Group→User).
        //    ⚠ Do NOT forward the rest of the mainForm here: the tab pages carry stateful fields (defaultProfile /
        //    checkbox_* "Default" columns) and after one server-side switch the URL no longer matches the rendered
        //    tab — a full-form replay was interpreted as a MODIFY ("set default ... failed", Error 27233, live on
        //    apps01 2026-07-02). tabPage+token alone switches cleanly with zero write risk.
        //    (NB the apps-sbx sandbox 500s this switch server-side even RAW — deployment bug, not ours.)
        var tabUrl = "", dialectLower = false;
        if (tabEl && tabEl.id) {
          var scripts = [].slice.call(document.querySelectorAll('script:not([src])')).map(function (s) { return s.textContent || ""; }).join("\n");
          var idx = scripts.indexOf(tabEl.id);
          if (idx >= 0) { var m = scripts.slice(idx, idx + 400).match(/([Tt])abSubmit\s*\(\s*['"]([^'"]+)['"]/); if (m) { dialectLower = m[1] === "t"; tabUrl = m[2]; } }
        }
        if (!tabUrl) return false;
        // Call Center Announcements uses short tab IDs, not relative URLs.
        // Its native TabSubmit posts the multipart form to a servlet, which
        // returns a redirect stub for the chosen announcement page.
        var tabAction = new URL(form.getAttribute('action') || location.pathname, location.href);
        if (/^\/commpilot\/servlet\/CallCenterAnnouncements[A-Za-z]*Servlet$/.test(tabAction.pathname) &&
            /^[a-z]+$/.test(tabUrl) && form.elements.namedItem('tabPage')) {
          form.elements.namedItem('tabPage').value = tabUrl;
          form.submit();
          return true;
        }
        if (/^\/(?:Group|ServiceProvider)\/DeviceInventory\/Modify\//.test(tabUrl)) {
          // The full Profile form POST to a sibling tab is interpreted as a
          // profile action and returns the list. Enter the tab with only the
          // profile identity instead; this is navigation, not a save.
          var identity = {};
          ["key", "P_key", "name", "P_name"].forEach(function (field) {
            var control = form.elements.namedItem(field);
            if (control && control.value) identity[field] = control.value;
          });
          if (!identity.key) return false;
          window.redirectPost("/commpilot" + tabUrl, identity);
          return true;
        }
        if (dialectLower) {
          // Enter the sibling tab as its OWN page, bare ({} — cpHook threads the token). Each tab IS a separate
          // page (verified apps01: bare POSTs render /Group/ and /User/ cleanly and location LANDS on the real
          // tab URL, so later relative navs resolve right). Posting {tabPage} to the current url only works from
          // the family's ENTRY page — from a sibling URL the tab controller reads the POST as an APPLY with
          // missing fields and attempts a MODIFY ("set default … failed", Error 27233, live 2026-07-02). A bare
          // per-page entry has no such ambiguity. If the wiring extraction failed, do NOTHING (a dead tab click
          // beats an accidental write).
          var resolved = "";
          var tabBase = location.pathname;
          if (cpSearchLanding && /\/commpilot\/Common\/(?:find|findAll|page|sort)\.jsp$/.test(tabBase))
            tabBase = cpSearchLanding;
          try { resolved = new URL(tabUrl, location.origin + tabBase).pathname; } catch (e) {}
          if (!resolved) return false;
          window.redirectPost(resolved, {});
          return true;
        }
        var params = {};
        try { new URLSearchParams(new FormData(form)).forEach(function (v, k) { params[k] = v; }); } catch (e) {}
        delete params.formtokenserial;   // cpHook threads the live single-use token
        if (tabUrl) params.tabPage = tabUrl;
        // Some DeviceInventory tabs provide a path rooted at CommPilot's app
        // directory ("/Group/..."). The browser treats it as an origin-root
        // path, so resolve that legacy spelling under /commpilot for transport.
        var target = tabUrl;
        // Some TabSubmit arguments are controller tab IDs, not URLs. The
        // native handler submits mainForm to its own action (or current page)
        // with tabPage set; resolving the ID as a relative URL returns 404.
        // Call Park's altRecallUser and Communication Barring's digitpatterns
        // both use this form.
        if (/^[A-Za-z][A-Za-z0-9]*$/.test(target) &&
            form.elements.namedItem('tabPage'))
          target = tabAction.pathname;
        // Executive's Alerting endpoint rejects a direct form POST. Its native
        // TabSubmit posts the current Assistants form with tabPage set instead.
        if (/^\/commpilot\/User\/Executive\/?$/.test(location.pathname) &&
            /^\/commpilot\/User\/Executive\/Alerting\/?$/.test(target))
          target = location.pathname;
        // Scheduled Reports paints the Active subpage at the parent list URL.
        // Its legacy sibling target is relative to Active/, so ../Completed/
        // would otherwise escape CCScheduledReports/ after the PJAX swap.
        var scheduledTab = /^\.\.\/(Active|Completed)\/?$/.exec(target);
        if (/^\/commpilot\/Group\/CCScheduledReports\/?$/.test(location.pathname) && scheduledTab)
          target = "/commpilot/Group/CCScheduledReports/" + scheduledTab[1] + "/";
        if (/^\/(?:Reseller|ServiceProvider|Group|User|Operator|System|Common)\//.test(target))
          target = "/commpilot" + target;
        window.redirectPost(target || (location.origin + location.pathname), params);
        return true;
      } catch (e) { console.warn("[pjax] cpTabNav:", e); return false; }
    }
    // Legacy tab handlers may die after a PJAX swap or submit the entire form
    // natively. Replay tabs with a known URL here, before those handlers run.
    // Lowercase tabSubmit uses a bare POST to the sibling entry page; the
    // sandbox's Group Assign Xsi form POST returns 500, while that entry works.
    document.addEventListener("click", function (ev) {
      var tab = ev.target && ev.target.closest ? ev.target.closest('td[width="82%"] a.tab') : null;
      if (!tab || !cpTabNav(tab)) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
    }, true);
    function cpGridBuildSubnav(state) {
      var host = state.wrap.querySelector(".cp-srch-subnav");
      if (!host) return;
      host.innerHTML = "";
      var tabEls = [].slice.call(document.querySelectorAll(".tabActive, a.tab"));
      if (tabEls.length >= 2) {
        var seg = document.createElement("div"); seg.className = "cp-srch-tabs";
        var madeBtns = [], anyOn = false;
        tabEls.forEach(function (t) {
          // Active tab = the .tabActive element OR (robust) the one that is NOT a link: the legacy active tab is a
          // <td>, the inactive ones are <a class="tab"> that redirectPost to the sibling sub-page. (Keying only on
          // the class missed it, so neither pill lit.)
          var on = /\btabactive\b/i.test(t.className || "") || (t.tagName || "").toUpperCase() !== "A";
          var b = document.createElement("button");
          b.type = "button"; b.className = "cp-srch-tab" + (on ? " cp-srch-tab-on" : "");
          b.textContent = (t.textContent || "").trim();
          if (!on) (function (tab) { b.addEventListener("click", function () { cpTabNav(tab); }); })(t);
          if (on) anyOn = true;
          madeBtns.push(b); seg.appendChild(b);
        });
        if (!anyOn && madeBtns[0]) madeBtns[0].classList.add("cp-srch-tab-on");   // last-resort: assume the first tab is current
        host.appendChild(seg);
      }
      var nameI = document.querySelector('input[name="newTagSetName"]');
      if (nameI) {
        var row = document.createElement("div"); row.className = "cp-srch-namerow";
        var lbl = document.createElement("label"); lbl.className = "cp-srch-namelbl";
        lbl.innerHTML = '<span class="cp-srch-req">*</span> Tag Set Name';
        nameI.classList.add("cp-srch-nameinput");
        var save = document.createElement("button"); save.type = "button"; save.className = "cp-srch-namesave"; save.textContent = "Save name";
        var apply = document.querySelector('input[name="apply"]') || document.querySelector('input[name="ok"]');
        if (apply) save.addEventListener("click", function () { try { apply.click(); } catch (e) {} });
        else save.style.display = "none";
        row.appendChild(lbl); row.appendChild(nameI); row.appendChild(save);
        host.appendChild(row);
      }
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
        // Mirror the RESULTS layout so the skeleton matches what loads in: the SAME header bar (titles + its
        // surface-low background) and the SAME column layout for the shimmer rows. Columns come from a prior
        // search (state.cols) or, on the first load, from the live headers captured at mount (state.skelCols).
        var rows = "", i, ci, n;
        var skc = (state.cols && state.cols.length) ? state.cols : state.skelCols;
        // Size the skeleton to the body with the SAME floor(h/46) the results render uses — but ONLY after the
        // skeleton HEADER is in the dhead. The dhead was just cleared (head.innerHTML = "" above); measuring the
        // body while it's empty leaves the body ~one header-height TALLER, over-counting perPage by a row → a
        // denser skeleton (e.g. 19 rows) than the 18 it fills into. The loaded grid measures with the header
        // present, so measuring here the same way makes the skeleton's row count + height match the result
        // EXACTLY (and thus identical across Groups/Users/Admins). (The Admins-style auto-load also reaches here
        // synchronously at mount, before the rAF fit runs, so state.perPage would otherwise still be the 12 default.)
        var fitN = function () {
          var bh = dbody.clientHeight;
          if (bh > 0) state.perPage = Math.max(4, Math.floor(bh / 46));
          return Math.max(8, state.perPage || 12);
        };
        if (skc && skc.length) {
          var tmpl = cpGridTemplate(skc, state);
          // Header bar: dark (surface-low) with shimmer PLACEHOLDERS, not the real titles — the extension is
          // shared across users, so nothing user-specific renders during loading. (skhd cells are block so the
          // % width resolves; CSP blocks inline style attrs so widths go through cpGridApplyBarWidths.)
          // Lead select-column cell (Option B) so the loading skeleton lines up with the delete-enabled grid.
          var skLead = state.delEnabled ? '<div class="cp-srch-td cp-srch-selcell"></div>' : "";
          var skLeadHd = state.delEnabled ? '<div class="cp-srch-selth"></div>' : "";
          head.style.gridTemplateColumns = tmpl;
          head.innerHTML = skLeadHd + skc.map(function (c) {
            var num = (c.type === "num" || c.type === "numpill");
            return '<div class="cp-srch-skhd' + (num ? " num" : "") + '"><span class="cp-srch-sk" data-w="' + (num ? 52 : 40) + '"></span></div>';
          }).join("");
          n = fitN();   // header now present → body at its real height → row count matches the loaded grid exactly
          for (i = 0; i < n; i++) {
            var cells = "";
            for (ci = 0; ci < skc.length; ci++) {
              var col = skc[ci], num = (col.type === "num" || col.type === "numpill");
              var w = num ? (30 + (i * 7) % 16) : (48 + (i * 13 + ci * 29) % 42);
              cells += '<div class="cp-srch-td' + (num ? " num" : "") + '"><span class="cp-srch-sk" data-w="' + w + '"></span></div>';
            }
            rows += '<div class="cp-srch-ghostrow cp-srch-skg">' + skLead + cells + "</div>";
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
        n = fitN();
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
      state._lastCrit = criteria;   // remembered so the modal-Add success path can refresh the same search
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
        // Events popup: the FIRST preload of a Schedule Modify page presents the popup (the page is
        // defunct); later loads within the same build (re-search) skip — a post-add/edit/delete
        // re-entry rebuilds a NEW state, so the popup re-opens there with fresh rows.
        if (state.pickerAuto && !state._pickerShown) {
          state._pickerShown = true;
          try { cpEventsPopup(state); } catch (e) {}
        }
        if (!state.all.length) {
          cpGridShowState(state, "nomatch");
          if (state.countN) state.countN.textContent = "0 results";
          return;
        }
        cpGridSortBy(state, state.sortK, state.sortDir, true);
        cpGridRenderResultsFillIn(state);   // fill the loading boxes in place, top-to-bottom, real content dropping from above
        // Re-fit AFTER the rows render. The build-time rAF fit (cpGridWireStaticHandlers) can run before an ASYNC
        // auto-load (Admins-style) has laid the body out, locking in a stale perPage → too-tall rows / sparse
        // ghost-fill. Recompute from the settled layout (no-op when perPage is already right — Groups/Users).
        requestAnimationFrame(function () { if (document.contains(state.wrap)) cpGridRecompute(state, false); });
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
      head.style.gridTemplateColumns = cpGridTemplate(state.cols, state);
      // Lead select-column header (Option B): a trash icon, muted until ≥1 row is selected, then it turns red and
      // acts as a "delete selected" button (opens the same confirm as the floating bar). Class is .cp-srch-selth
      // (NOT .cp-srch-th) so the sort-wiring loop below skips it.
      var leadHd = state.delEnabled
        ? '<div class="cp-srch-selth"><span class="cp-srch-selhdr-del' + (cpGridSelCount(state) > 0 ? " hot" : "") + '" role="button" aria-label="Delete selected" title="Delete selected">' + CP_SVG_TRASH + '</span></div>'
        : "";
      head.innerHTML = leadHd + state.cols.map(function (c) {
        var arrow = (c.idx === state.sortK)
          ? '<span class="cp-srch-arr">' + (state.sortDir > 0 ? CP_SVG_ARRUP : CP_SVG_ARRDOWN) + '</span>' : "";
        return '<div class="cp-srch-th' + (c.align === "center" ? " cen" : (c.num ? " num" : "")) + '" data-k="' + c.idx + '">' +
          '<span class="cp-srch-thlbl" title="' + cpEsc(c.label) + '">' + cpEsc(c.label) + '</span>' + arrow + '</div>';
      }).join("");
      var hdrDel = head.querySelector(".cp-srch-selhdr-del");
      if (hdrDel) hdrDel.addEventListener("click", function () { if (cpGridSelCount(state) > 0) cpGridOpenDelConfirm(state); });
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
    function cpGridTemplate(cols, state) {
      // Mirrors the mockup's proportional widths: id/name wider, a fixed last column for numbers.
      // A leading 46px SELECT column when multi-select delete is enabled (Option B) — the checkbox gets its own
      // section, separate from the id/name column. Off (delEnabled false) ⇒ template is byte-identical to before.
      // SERVICE INSTANCES ONLY (detected by its distinctive "Service Type" column): rebalance the 7 columns so the
      // long User-ID emails get the room they need and the narrow ones don't hog width — fits without scroll. Pure
      // fr ratios (no hard mins) so it never overflows. Every OTHER grid falls through to the unchanged default.
      var lead = (state && state.delEnabled) ? "46px " : "";
      var isSI = cols.some(function (c) { return (c.label || "").toLowerCase() === "service type"; });
      return lead + cols.map(function (c, i) {
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
      var lead = state.delEnabled ? cpGridSelCellHTML(state, row) : "";   // dedicated select column (Option B)
      return '<div class="cp-srch-drow">' + lead + state.cols.map(function (c) { return cpGridCellHTML(state, row, c); }).join("") + "</div>";
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
      var lead = state.delEnabled ? '<div class="cp-srch-td cp-srch-selcell"></div>' : "";   // empty lead cell keeps ghost rows aligned with the select column
      return '<div class="cp-srch-ghostrow">' + lead + cells + "</div>";
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
      var tmpl = cpGridTemplate(state.cols, state);
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
        var resTmpl = cpGridTemplate(state.cols, state);
        var firstSk = skwrap.querySelector(".cp-srch-skg, .cp-srch-skrow");
        var expectCols = state.cols.length + (state.delEnabled ? 1 : 0);   // +1 for the lead select column
        if (!firstSk || firstSk.classList.contains("cp-srch-skrow") || firstSk.children.length !== expectCols || firstSk.style.gridTemplateColumns !== resTmpl) {
          var nsk = Math.max(8, state.perPage), shtml = "", si, sci;
          var sLead = state.delEnabled ? '<div class="cp-srch-td cp-srch-selcell"></div>' : "";
          for (si = 0; si < nsk; si++) {
            var scells = "";
            for (sci = 0; sci < state.cols.length; sci++) {
              var scol = state.cols[sci], snum = (scol.type === "num" || scol.type === "numpill");
              scells += '<div class="cp-srch-td' + (snum ? " num" : "") + '"><span class="cp-srch-sk" data-w="' + (snum ? (30 + (si * 7) % 16) : (48 + (si * 13 + sci * 29) % 42)) + '"></span></div>';
            }
            shtml += '<div class="cp-srch-ghostrow cp-srch-skg">' + sLead + scells + "</div>";
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
        // A click on a row's select box toggles selection — never drills (stop it propagating to the row nav).
        var selEl = e.target.closest && e.target.closest(".cp-srch-selbox");
        if (selEl) { e.stopPropagation(); cpGridToggleSel(state, selEl.getAttribute("data-name")); return; }
        if (e.target.closest && e.target.closest(".cp-srch-selcell")) return;   // clicks in the select column never drill
        var rowEl = e.target.closest && e.target.closest(".cp-srch-drow");
        if (!rowEl) return;
        var idx = [].indexOf.call(rowEl.parentNode.children, rowEl) + state.page * state.perPage;
        var row = state.cur[idx];
        // Schedules list: a schedule click opens the BACKGROUND events popup instead of navigating —
        // the Schedule Modify page is defunct (user re-scope 2026-07-06).
        if (row && row.drill && state.schedList) { cpEventsPopupBg(state, row); return; }
        if (row && row.drill && typeof redirectPost === "function") redirectPost(row.drill.url, row.drill.params);
      });
      // The +/− (Add/remove filter) and Search controls live INSIDE the criterion rows now (right of each row),
      // so they're wired per-render in cpGridRenderFilters — not here.
      // Multi-select delete floating bar (inert until a row is selected; the bar shows/hides via cpGridUpdateDelBar).
      var delClear = w.querySelector(".cp-srch-delclear");
      var delDo = w.querySelector(".cp-srch-deldo");
      if (delClear) delClear.addEventListener("click", function () { cpGridClearSel(state); });
      if (delDo) delDo.addEventListener("click", function () { cpGridOpenDelConfirm(state); });
      window.addEventListener("resize", function () { if (document.contains(state.wrap)) cpGridRecompute(state); });
    }
    function cpGridRenderFilters(state, n) {
      state.criteriaCount = n;
      var frows = state.wrap.querySelector(".cp-srch-frows");
      var fieldSel = state.fieldOpts.map(function (o, i) { return '<option value="' + cpEsc(o.value) + '"' + (i === 0 ? " selected" : "") + ">" + cpEsc(o.label) + "</option>"; }).join("");
      var opSel = state.opOpts.map(function (o, i) { return '<option value="' + cpEsc(o.value) + '"' + (i === 0 ? " selected" : "") + ">" + cpEsc(o.label) + "</option>"; }).join("");
      var legacy = state.legacySearch;
      var listSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
      var html = "";
      for (var i = 0; i < n; i++) {
        // Row action slot. Admins-style (server search): Find All (doFindAll: clear → all) + Find (doFind:
        // field/match/value) — single criterion, no "+". Preload-style (Groups/Users): the FIRST row carries
        // the "+" box (add a criterion) + the Search button; every added row carries a "−" box.
        var act;
        if (legacy) {
          act = '<button type="button" class="cp-srch-btn cp-srch-findall">' + listSvg + '<span>Find All</span></button>' +
            '<button type="button" class="cp-srch-btn cp-srch-go">' + CP_SVG_SEARCH + '<span>Find</span></button>';
        } else {
          act = (i === 0)
            ? '<button type="button" class="cp-srch-minib cp-srch-addb" title="Add filter">' + CP_SVG_PLUS + '</button>' +
              '<button type="button" class="cp-srch-btn cp-srch-go">' + CP_SVG_SEARCH + '<span>Search</span></button>'
            : '<button type="button" class="cp-srch-minib cp-srch-rm" title="Remove filter">' + CP_SVG_MINUS + '</button>';
        }
        // Order: Field, Match, then VALUE (cp-srch-vslot — swapped in place for text / department dropdown /
        // Yes-No toggle by cpGridRenderRowValue), then the row actions. Mirrors the legacy page's layout.
        html += '<div class="cp-srch-frow' + (legacy ? ' cp-srch-frow-legacy' : '') + '">' +
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
      // Search / Find → run the search (cpGridRunSearch routes to the page's doFind for legacy-search pages).
      var go = frows.querySelector(".cp-srch-go");
      if (go) go.addEventListener("click", function () { cpGridRunSearch(state); });
      // Find All (legacy-search pages) → drive the page's own doFindAll (clears criteria → every row).
      var fa = frows.querySelector(".cp-srch-findall");
      if (fa) fa.addEventListener("click", function () { cpGridDriveFind(state, true); });
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
    // Drive the legacy page's OWN search (Admins-style server search). Find: copy the grid's first filter row
    // into the hidden findKey/findOp/findValue, then call the page's doFind (→ redirectPost find.jsp). Find All:
    // call doFindAll (→ findAll.jsp, every row). The page re-renders via pjax and the grid rebuilds on cp:reskin,
    // re-skinning the REAL server result — generic, and scales to server-paginated lists.
    function cpGridDriveFind(state, findAll) {
      try {
        if (findAll) {
          if (typeof window.doFindAll === "function") { window.doFindAll(); return; }
        } else {
          var fr = state.wrap.querySelector(".cp-srch-frow");
          if (fr) {
            var fk = document.querySelector('select[name="findKey"]'),
                fo = document.querySelector('select[name="findOp"]'),
                fv = document.querySelector('[name="findValue"]');
            if (fk) fk.value = fr.querySelector(".cp-srch-field").value;
            if (fo) fo.value = fr.querySelector(".cp-srch-op").value;
            if (fv) fv.value = cpGridRowValue(fr);
          }
          if (typeof window.doFind === "function") { window.doFind(); return; }
        }
      } catch (e) { console.warn("[search] legacy-search drive failed", e); }
    }
    function cpGridRunSearch(state) {
      // Admins-style: drive the page's OWN server search instead of a local filter (scales to paginated lists).
      if (state.legacySearch) { cpGridDriveFind(state, false); return; }
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

    // Single-page sign-out. The native header Logout link, confirmed in the
    // extension's modal, sets cp-signing-out before calling redirectPost.
    // Rather than navigate to the raw /Logout/ landing and then bounce to
    // /Login/ (two documents → spinner restart + flash), we run the SAME logout
    // request as a background fetch while the "Signing out…" spinner stays on
    // THIS page, hold it for a minimum beat, then go once to the styled login.
    // Faithful to the real request: same url + params + the live formtokenserial
    // (what redirectPost itself would post). On fetch failure we fall back to the
    // real navigation logout (correctness over polish); the logout-page bridge
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
        cpDbg("[pjax] sign-out fetch", url);
        // redirect:"manual" — a sign-out POST that the server answers with an http:// Login/Logout bounce means
        // the session is already gone; letting the browser follow that hop would CSP-fail (mixed content) → a
        // spurious connect-src violation + fallback. An opaqueredirect RESOLVES, so go() runs (navigates onward)
        // exactly as on a clean 200. See [[gotcha-csp-inline-style-attr-blocked]].
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "same-origin",
          redirect: "manual"
        }).then(go, fallback);
      } catch (e) { fallback(); }
    }

    cpHook = function (url, params, _retry) {
      try {
        // A deliberate sign-out should leave the native login page visible
        // briefly after a user-initiated sign-out.
        if (typeof url === "string" && /\/Logout(?:\/|$)/i.test(url)) {
          try { sessionStorage.setItem("bwManualLogoutAt", String(Date.now())); } catch (e) {}
        }
        // SYNTHETIC-NAV GUARD: cpListSearch's client-fill harvest re-dispatches DOMContentLoaded to run a
        // page's own fill. On some pages (DeviceInventory) a DCL handler NAVIGATES (redirectPost to the
        // landing) instead of filling — 60 spin ticks fired repeated token-bearing POSTs into a 500ing
        // endpoint and KILLED the session (live 2026-07-02). Handlers run synchronously inside the
        // re-dispatch, so navs arriving inside the flag window are ours — drop them.
        if (cpDclSpin) { cpDbg("[pjax] ignoring synthetic nav during client-fill spin:", url); return; }
        // Resolve a RELATIVE redirectPost target (e.g. the admin Add button's "Add/index.jsp") to an absolute
        // /commpilot path so isPjaxUrl can match it — otherwise cpHook native-navigates → a full page load.
        // (Only relative targets are touched; absolute "/commpilot/..." urls pass through unchanged.)
        // Scheduled Reports emits ../Add/index.jsp from its list landing even
        // though its Add form lives under CCScheduledReports/Add/. The browser
        // would otherwise resolve that to the nonexistent /Group/Add/ page.
        if (url === "../Add/index.jsp" &&
            /\/Group\/CCScheduledReports\/$/.test(location.pathname))
          url = "/commpilot/Group/CCScheduledReports/Add/index.jsp";
        if (typeof url === "string" && url && url.charAt(0) !== "/" && !/^https?:/i.test(url)) {
          // Resolve against the list LANDING (not location) when the address bar is stuck on a /Common search
          // artifact — otherwise the list's Add/Import buttons ("Add/index.jsp") resolve to /Common/Add/index.jsp
          // → 404. (See cpSearchLanding.) Normal case still resolves against location.href.
          var _base = location.href;
          if (cpSearchLanding && /\/commpilot\/Common\/(find|findAll|page|sort)\.jsp/.test(location.pathname)) {
            _base = location.origin + cpSearchLanding;
          }
          try { url = new URL(url, _base).pathname; } catch (e) {}
        }
        // Service Pack Migration opens its wizard in a named popup and
        // temporarily targets redirectPost's form there. Keep that native
        // target: fetching the wizard into the parent PJAX shell instead
        // leaves the popup blank and can send the parent to Login.
        if (typeof url === "string" &&
            /\/ServiceProvider\/ServicePackMigration\/Wizard\//.test(url) &&
            window.wizardWin && window.wizardWin.win && !window.wizardWin.win.closed) {
          _orig(url, params);
          return;
        }
        // Sign-out interception (must precede isPjaxUrl): the confirmation
        // arms cp-signing-out for this one Logout redirectPost only.
        var _so = 0; try { _so = parseInt(sessionStorage.getItem("cp-signing-out") || "0", 10); } catch (e) {}
        if (_so && typeof url === "string" && /\/Logout(?:\/|$)/i.test(url) &&
            Date.now() - _so < 15000) {
          try { sessionStorage.removeItem("cp-signing-out"); } catch (e) {}
          cpSignOutFetch(url, params || {});
          return;
        }
        if (isPjaxUrl(url)) {
          // Preserve the workspace scroll position on the history entry we
          // are leaving. The window itself remains fixed in the new shell.
          if (!cpPopReplaying) {
            try {
              var oldScroller = document.querySelector('.cp-console') || document.querySelector('td[width="82%"][valign="top"]');
              history.replaceState(Object.assign({}, history.state || {}, {
                cpMainScroll: oldScroller ? oldScroller.scrollTop : 0
              }), "", location.href);
            } catch (e) {}
          }
          // At SP/Group/User level the board must finish its sequential folder
          // reads and re-enter the entity context before a linked page opens.
          // Otherwise the first page can load but its next Search POST fails.
          if (cpAggActive) {
            var boardReady = cpAggNavReady && cpAggNavReady.promise;
            var boardNavSeq = ++cpSeq;
            cpDbg("[pjax] board nav queued", url, boardNavSeq);
            if (boardReady) boardReady.then(function (ready) {
              cpDbg("[pjax] board nav ready", url, ready, boardNavSeq, cpSeq);
              if (cpSeq !== boardNavSeq) return;
              if (ready) cpHook(url, params, _retry);
              else cpUploadNotice("CommPilot could not finish loading this menu. Reload this page before opening an option.");
            });
            return;
          }
          // Reseller folder reads are plain fetches. Cancel any unfinished
          // read and drain its token-bearing POST before starting navigation.
          if (document.querySelector(".cp-console") && cpSectionRunning) {
            cpSectionAborted = true;
            cpAggEnd();
            if (cpInflightPosts > 0) {
              var waitSeq = ++cpSeq, waited = 0;
              var continueAfterAgg = function () {
                if (cpSeq !== waitSeq) return;
                if (cpInflightPosts === 0 || waited++ >= 250) {
                  if (cpInflightPosts > 0) console.warn("[pjax] menu prefetch did not drain before navigation");
                  cpHook(url, params, _retry);
                } else setTimeout(continueAfterAgg, 20);
              };
              setTimeout(continueAfterAgg, 0);
              return;
            }
          }
          var mySeq = ++cpSeq;
          // Remember the list landing a search was launched FROM (location is still the real landing here, before
          // the swap repaints the address bar as /Common/findAll.jsp) so later relative navs resolve right.
          try {
            if ((url.indexOf("/Common/find.jsp") !== -1 || url.indexOf("/Common/findAll.jsp") !== -1) &&
                !/\/commpilot\/Common\/(find|findAll|page|sort)\.jsp/.test(location.pathname)) {
              cpSearchLanding = location.pathname;
              // Some legacy Find pages insert a state-less history entry. Keep
              // the exact landing POST so Back can replay that entry in-shell.
              cpSearchLandingNav = history.state && history.state.cpNav && history.state.cpNav.url ?
                { url: history.state.cpNav.url, params: history.state.cpNav.params || {} } : null;
            }
          } catch (e) {}
          // A real navigation (drill-in, reload replay, sidebar click) supersedes any in-flight grid search OR
          // deep sweep — abort both so their background fetches stop rotating the single-use token and racing
          // with THIS POST.
          try { if (cpGridState && cpGridState._searchAbort) cpGridState._searchAbort.abort(); } catch (e) {}
          try { if (cpGridState && cpGridState._sweepAbort) cpGridState._sweepAbort.abort(); } catch (e) {}
          var drainSeq = ++cpTokenDrainSeq;
          // Aborting a grid sweep stops its NEXT page request, but a POST that
          // already reached CommPilot can still consume the single-use token.
          // Let that response refresh the live token before sending this nav.
          if (cpInflightPosts > 0) {
            var drainTicks = 0;
            (function drainBeforeNav() {
              if (drainSeq !== cpTokenDrainSeq) return; // a newer click wins
              if (cpInflightPosts === 0) { cpHook(url, params, _retry); return; }
              if (++drainTicks > 250) {
                console.warn('[pjax] prior CommPilot request did not finish; navigation was not sent with a stale token');
                cpUploadNotice('A previous CommPilot request is still running. Please try again.');
                return;
              }
              setTimeout(drainBeforeNav, 20);
            })();
            return;
          }
          // Classify the nav so reload-recovery never remembers a FORM submit or an Add-form open: cold-replaying
          // those bounces to /Login/ on a still-alive session (the idle-reload-logout). A SUBMIT carries an action
          // button param (ok/apply/delete/cancel/buttonClicked); an Add form is a deep create page. NB we deliberately
          // do NOT exclude /Modify/ broadly — SP/Group/User console drill-ins use Modify and ARE valid recover-navs.
          // See [[gotcha-idle-connection-drop-dead-click]].
          var _submitNav = !!(params && (params.ok != null || params.apply != null || params.delete != null || params.cancel != null || params.buttonClicked != null));
          var _numberEditForm = /\/Group\/GroupDnManagement\/Nested\//.test(url);
          var _addForm = /\/(?:Add|AddRange|AddModify)\//.test(url) || _numberEditForm;
          // Remember the list a form is being OPENED from (location is still the list here, pre-swap).
          // Only when the current page is NOT itself a form URL, so form→form chains (Modify → Add Tag)
          // keep the ORIGINAL list as the return anchor. Consumed by the canonical re-anchor below.
          try {
            if ((/\/(?:Add|AddRange|AddModify|Import|Modify)\//.test(url) || _numberEditForm) &&
                !(/\/(?:Add|AddRange|AddModify|Import|Modify)\//.test(location.pathname) ||
                  /\/Group\/GroupDnManagement\/Nested\//.test(location.pathname))) {
              cpFormOrigin = location.pathname;
            }
          } catch (e) {}
          // cpLastNav drives the F5 in-shell replay — never remember a SUBMIT (replaying it would re-submit the form);
          // an Add-form OPEN is fine to remember (F5 just re-opens it in-shell).
          try { if (!_submitNav) cpLastNav = { url: url, params: params || {} }; } catch (e) {}
          // Remember the SP entry (Modify nav) — recorded for reload/replay + future Group/User work.
          try { if (/\/ServiceProviders\/Modify\//.test(url)) cpSpEntry = { url: url, params: params || {} }; } catch (e) {}
          // Persisted browser-reload recover-nav (stubguard cold-POST-replays this). Exclude form submits + Add opens
          // (and page.jsp/sort.jsp) so recovery falls back to the last LIST/console nav, which replays cleanly.
          try { if (url.indexOf("/Common/page.jsp") === -1 && url.indexOf("/Common/sort.jsp") === -1 && !_submitNav && !_addForm) { var _nav = { url: url, params: params || {}, entry: (cpEntityEntry && cpEntityEntry.url !== url) ? cpEntityEntry : null }; sessionStorage.setItem("cp-last-nav", JSON.stringify(_nav)); window.postMessage({ __cpRecoverNav: _nav }, location.origin); } } catch (e) {}
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var firstTok = liveTokEl ? liveTokEl.value : null;
          var cpLoader = cpNeedsFrame(url, params) ? cpFollowFrame : cpFollow;
          var cpHistoryBeforeLoad = history.length;
          cpDbg("[pjax]", cpLoader === cpFollowFrame ? "iframe-loading" : "fetching", url);
          cpLoader(url, params, firstTok, 0)
            .then(function (res) {
              if (mySeq !== cpSeq) {
                cpDbg("[pjax] superseded — dropping stale swap");
                return;
              }
              if (res && res.unverifiedSave) {
                cpUploadNotice(res.unverifiedSave);
                return;
              }
              if (res && res.err >= 500) {
                // The server 500'd this nav. Do NOT retry, harvest, or fall to a native POST — every further
                // request into a 500ing endpoint risks killing the session (proven live 2026-07-02). Stay on
                // the current page and tell the user.
                console.warn("[pjax] server " + res.err + " on " + url + " — staying on the current page (no retry)");
                // Styled in-page banner (reuses skin.css .cp-alert) instead of window.alert — the native alert
                // BLOCKS the page (and automation) and looks off-theme. Auto-dismisses; page state untouched.
                try {
                  cpErr5xxStreak++;
                  var _bc = document.querySelector('td[width="82%"]');
                  if (_bc && cpErr5xxStreak >= 2) {
                    // Second 5xx in a row — the session is almost certainly dead (this host echoes
                    // 500s on every request once it kills a session). One actionable banner instead
                    // of a stack of identical server-error ones.
                    Array.prototype.forEach.call(_bc.querySelectorAll(".cp-alert"), function (a) { try { a.remove(); } catch (e) {} });
                    var _sb = document.createElement("div");
                    _sb.className = "cp-alert cp-alert-warning";
                    _sb.innerHTML =
                      '<div class="cp-alert-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>' +
                      '<div class="cp-alert-content"><div class="cp-alert-title">Session expired</div>' +
                      '<div class="cp-alert-body">The server is rejecting requests — the sandbox has most likely timed out your session. Sign in again to continue where you left off.</div></div>' +
                      '<button type="button" class="cp-alert-act">Sign in</button>';
                    _sb.querySelector(".cp-alert-act").addEventListener("click", function () { location.assign("/commpilot/Login/"); });
                    _bc.insertBefore(_sb, _bc.firstChild);
                  } else if (_bc) {
                    var _bn = document.createElement("div");
                    _bn.className = "cp-alert cp-alert-error";
                    _bn.innerHTML =
                      '<div class="cp-alert-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg></div>' +
                      '<div class="cp-alert-content"><div class="cp-alert-title">Server error</div>' +
                      '<div class="cp-alert-body">The server couldn\'t load that page — you\'re still on the previous page. Try again in a moment.</div></div>' +
                      '<span class="cp-alert-chip">HTTP ' + res.err + '</span>';
                    _bc.insertBefore(_bn, _bc.firstChild);
                    setTimeout(function () { try { _bn.remove(); } catch (e) {} }, 9000);
                  } else {
                    window.alert("The server couldn't load that page (error " + res.err + ").");
                  }
                } catch (e) {}
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
                  // Token did NOT rotate — the common case on a server login-BOUNCE (the rejected POST rendered
                  // no new token). Rather than fall straight to _orig (a native full-page redirectPost that FOLLOWS
                  // the server's http:// Login bounce → a visible "session timeout" logout of a possibly-still-alive
                  // session), first try to RECOVER IN PLACE: harvest a fresh app token from servlet/Login and retry
                  // the nav with it. Only if the harvest yields nothing (session genuinely dead) fall to _orig.
                  // Preserves the redirect:'manual' noise/CSP win while restoring "never hard-logout an alive session".
                  cpHarvestFreshToken().then(function (tok) {
                    if (mySeq !== cpSeq) { cpDbg("[pjax] superseded — dropping stale harvest"); return; }
                    if (tok) {
                      var _toks = document.getElementsByName("formtokenserial");
                      for (var _i = 0; _i < _toks.length; _i++) _toks[_i].value = tok;
                      console.warn("[pjax] follow unusable, token not rotated — harvested a fresh token, re-attempting nav in place");
                      cpHook(url, params, true);
                    } else {
                      if (!cpSessionRedirecting) {
                        cpSessionRedirecting = true;
                        console.warn("[pjax] no content cell after follow + harvest empty — opening sign-in");
                        location.replace("/commpilot/Login/");
                      }
                    }
                  });
                  return;
                }
                if (!cpSessionRedirecting) {
                  cpSessionRedirecting = true;
                  console.warn("[pjax] no content cell after follow — opening sign-in");
                  location.replace("/commpilot/Login/");
                }
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
              // Single-item drill-in SKIP (user request 2026-07-04): the DeviceType row drill lands on a
              // one-card mini menu (RESELLER → <type> → "Profile") whose only item forwards to the Modify
              // form — pure friction. Detect it in the FETCHED doc BEFORE painting and forward straight to
              // the form: no flash, no sidebar swap, no history entry for the menu (Back = the list).
              // v0.2.302 did this POST-swap via cpGridActionTarget, whose relative target resolved against
              // the LIST landing → POSTed /Reseller/DeviceType/Profile/… → HTTP 500s (user report). The
              // target is now extracted from the fetched doc's own wiring and resolved against the KNOWN
              // Operator/System/DeviceType/ base this drill lives under.
              try {
                if (/\/DeviceType\/Modify\/(index\.jsp)?$/.test(url)) {
                  var _ml = fetched.querySelectorAll('a[id^="link_"]');
                  if (_ml.length === 1 && _ml[0].id) {
                    var _msrc = "";
                    var _mss = doc.querySelectorAll("script");
                    for (var _mi = 0; _mi < _mss.length; _mi++) _msrc += (_mss[_mi].textContent || "") + "\n";
                    var _mj = _msrc.indexOf(_ml[0].id);
                    var _mm = _mj >= 0 ? /redirectPost\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/.exec(_msrc.slice(_mj, _mj + 400)) : null;
                    if (_mm) {
                      var _mu = _mm[1].replace(/\\u002F/g, "/");
                      if (_mu.charAt(0) !== "/") _mu = "/commpilot/Operator/System/DeviceType/" + _mu;
                      if (_mu.indexOf("/DeviceType/Profile/") !== -1) {
                        var _mp = {}, _mre = /(\w+)\s*:\s*['"]([^'"]*)['"]/g, _mkv;
                        while ((_mkv = _mre.exec(_mm[2]))) _mp[_mkv[1]] = _mkv[2].replace(/\\u003E/g, ">").replace(/\\u0025/g, "%").replace(/\\u002F/g, "/");
                        cpDbg("[pjax] single-item drill skip ->", _mu);
                        cpHook(_mu, _mp);
                        return;
                      }
                    }
                  }
                }
              } catch (e) {}
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
                  cpEntityEntry = { url: url, params: params || {} };   // this nav set the server's target context
                }
              } catch (e) { console.warn("[pjax] sidebar swap", e); cpLiveNav = null; }

              // Update tab title from fetched page
              try { if (doc.title) document.title = doc.title; } catch (e) {}

              // The header has several td.headerBar cells (spacers, logo, Help,
              // auth trail, Welcome). Select the cell that actually holds the
              // native breadcrumb; querySelector("td.headerBar") selects a spacer.
              // Copy its fresh markup so the trail and current user match the page.
              var cpLiveHeader = null;
              try {
                var hasTrail = function (cell) { return !!cell.querySelector("a.headerAuthLevelLink, span.headerAuthLevel"); };
                var findHeader = function (cells) {
                  for (var i = 0; i < cells.length; i++) if (hasTrail(cells[i])) return cells[i];
                  return null;
                };
                var nextHeader = findHeader(doc.querySelectorAll("td.headerBar"));
                var currentHeader = findHeader(document.querySelectorAll("td.headerBar"));
                if (nextHeader && currentHeader) {
                  currentHeader.innerHTML = nextHeader.innerHTML;
                  cpLiveHeader = currentHeader;
                }
              } catch (e) { console.warn("[pjax] header sync", e); }

              // The native header above was refreshed from the response. Do not
              // insert the former extension's pill breadcrumb into the content.

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

              // Inline page scripts can submit relative form actions immediately
              // when re-executed. Make the fetched page's URL current first, so
              // those actions resolve as they would after a native navigation.
              cpConfigFilesForwarded = false;
              var cpState = { cpNav: { url: url, params: params || {},
                entry: (cpEntityEntry && cpEntityEntry.url !== url) ?
                  { url: cpEntityEntry.url, params: cpEntityEntry.params || {} } : null } };
              var cpHistoryMode = cpPopReplaying || cpAutoReplaceUrl === url ||
                (cpLoader === cpFollowFrame && history.length > cpHistoryBeforeLoad) ? "replace" : "push";
              if (cpAutoReplaceUrl === url) cpAutoReplaceUrl = null;
              var cpHistoryCommitted = false;
              try {
                history[cpHistoryMode + "State"](cpState, "", url);
                cpHistoryCommitted = true;
                cpPopReplaying = false;
              } catch (e) {}
              // A new page must start at its top. Without this, a long form's
              // body scroll carries into the next PJAX page and hides the
              // CommPilot logo/Help row above the viewport. Leave replace
              // entries alone so Back/Forward can restore their scroll.
              if (cpHistoryMode === "push" && cpHistoryCommitted) {
                try { window.scrollTo(0, 0); } catch (e) {}
                try { liveCell.scrollTop = 0; } catch (e) {}
              }
              try { document.documentElement.setAttribute("data-cp-path", url); } catch (e) {}

              // Re-execute swapped scripts under nonce-CSP. CAPTURE each page DOMContentLoaded handler (e.g. the
              // Admins row-fill) into a fresh per-nav list so a consumer that needs the page to (re)render can
              // re-invoke it. A pjax swap fires no real DCL, and the one-shot microtask call below can run BEFORE
              // the handler's (async) data exists — the Admins fill renders empty then, and is never re-run.
              // The grid re-invokes window.__cpDclFns until its rows populate. (NOT registered on the real doc —
              // that would accumulate stale handlers across navs.)
              if (cpExternalDclRestore) cpExternalDclRestore();
              window.__cpDclFns = [];
              var origAdd = document.addEventListener;
              document.addEventListener = function (type, fn, opts) {
                if (type === "DOMContentLoaded" && typeof fn === "function") {
                  try { window.__cpDclFns.push(fn); } catch (e) {}
                  Promise.resolve().then(function () {
                    try {
                      fn.call(document, new Event("DOMContentLoaded"));
                    } catch (e) {
                      cpWarnCo("dclerr|" + String((e && e.message) || e), "[pjax] DCL err: " + String((e && e.message) || e));
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
                    try { fn.call(window, new Event("load")); } catch (e) { cpWarnCo("loadshim|" + String((e && e.message) || e), "[pjax] load shim err: " + String((e && e.message) || e)); }
                  });
                  return;
                }
                return origWinAdd.call(this, type, fn, opts);
              };
              var n = 0;
              var externalScripts = [];
              cpSrcCollector = externalScripts;
              cpReexecutingScripts = true;
              try {
                n = reexecScripts(liveCell);
                if (cpLiveNav) reexecScripts(cpLiveNav);
                if (cpLiveHeader) {
                  // BroadWorks wires breadcrumb links in DCL script tags inside this
                  // cell. The swapped scripts must run once; omit them from the
                  // grid's later DCL retries to avoid duplicate click handlers.
                  var headerDclStart = window.__cpDclFns.length;
                  n += reexecScripts(cpLiveHeader);
                  window.__cpDclFns.splice(headerDclStart);
                }
              } finally { cpReexecutingScripts = false; cpSrcCollector = null; }
              var restoreDcl = function () {
                if (cpExternalDclRestore !== restoreDcl) return;
                document.addEventListener = origAdd;
                window.addEventListener = origWinAdd;
                cpExternalDclRestore = null;
              };
              cpExternalDclRestore = restoreDcl;
              if (externalScripts.length) {
                var pendingScripts = externalScripts.filter(function (script) { return !script._cpLoaded; });
                if (pendingScripts.length) {
                  var scriptDone = function () {
                    pendingScripts = pendingScripts.filter(function (script) { return !script._cpLoaded; });
                    if (!pendingScripts.length) restoreDcl();
                  };
                  pendingScripts.forEach(function (script) {
                    script.addEventListener("load", scriptDone, { once: true });
                    script.addEventListener("error", scriptDone, { once: true });
                  });
                  setTimeout(restoreDcl, 4000);
                } else restoreDcl();
              } else restoreDcl();
              if (window.redirectPost !== cpHook) { _orig = window.redirectPost; window.redirectPost = cpHook; }
              cpDbg("[pjax] re-executed", n, "scripts");
              // Stamp the NAV TARGET on <html> BEFORE the reskin: cp:reskin handlers run before the address-bar
              // history update, so location.pathname is still the PREVIOUS page inside them. skin.js's
              // pathname-keyed form dispatch (the notification-email family) reads this attribute first.
              try { document.documentElement.setAttribute("data-cp-path", url); } catch (e) {}
              // Successful swap: the session is alive — reset the dead-session streak, stamp the
              // idle watchdog, and clear a stale idle-warning banner.
              cpErr5xxStreak = 0;
              cpLastSwapAt = Date.now();
              try { var _iw = document.getElementById("cp-idle-warn"); if (_iw) _iw.remove(); } catch (e) {}
              document.dispatchEvent(new CustomEvent("cp:reskin"));
              cpDbg("[pjax] reskin dispatched");
              var canonical = url;
              if ((url.indexOf("/Common/page.jsp") !== -1 || url.indexOf("/Common/sort.jsp") !== -1) && params && params.returnPage) {
                var rp = String(params.returnPage);
                canonical = rp.indexOf("/commpilot") === 0 ? rp : ("/commpilot" + (rp.charAt(0) === "/" ? rp : "/" + rp));
              }
              // An admin form action (Add/Modify OK/Cancel/Delete) POSTs to the form endpoint but RETURNS the
              // list — leaving the URL at the form endpoint breaks the next relative nav (the Add button's
              // "Add/index.jsp" would resolve to .../Add/Add/index.jsp → ERROR). When the swapped content is the
              // LIST (the admin form's password field is absent), canonicalize the URL to the list directory.
              try {
                if (/\/Admins\/(Add\/|Modify\/|modify\.jsp)/i.test(url) && liveCell && liveCell.querySelector && !liveCell.querySelector('input[name="password"]')) {
                  canonical = url.replace(/\/(Add|Modify)\/(index\.jsp)?$/i, "/").replace(/\/modify\.jsp$/i, "/");
                }
              } catch (e) {}
              // GENERALIZED form-submit re-anchor (the Admins case above, for every form family): a submit
              // (ok/apply/cancel/delete) POSTed to a form endpoint whose response renders the LIST screen
              // (find-criteria controls or Add buttons present) re-anchors to the list the form was opened from — NOT a
              // path-strip of the form URL, because the form can live under a different tree than its list
              // (DeviceType list = /Reseller/DeviceType/ but its Add = /Operator/System/DeviceType/Add/).
              try {
                if (_submitNav && cpFormOrigin && canonical === url &&
                    (/\/(?:Add|AddRange|AddModify|Import|Modify)\//.test(url) || _numberEditForm ||
                      /\/Operator\/System\/DeviceType\/Profile\//.test(url)) &&
                    !/\b(?:Add|Modify|Import)\b/i.test(doc.title || '') &&
                    liveCell && liveCell.querySelector &&
                    !liveCell.querySelector('input[name="unicodeLastName"], input[name="clidLastName"]') &&
                    liveCell.querySelector('select[name="findKey0"], select[name="findKey"], #searchTable, input[name="add"][type="button"], input[name="addBasic"][type="button"], input[name="addByWeightedRouting"], input[name="addByOrderedRouting"], button[name="add"]')) {
                  canonical = cpFormOrigin;
                  document.documentElement.setAttribute("data-cp-path", canonical);
                }
              } catch (e) {}
              try {
                if (_submitNav && /\/Group\/Call_Center\/AddModify\//.test(url) &&
                    liveCell && liveCell.querySelector && liveCell.querySelector('input[name="addBasic"]')) {
                  canonical = '/commpilot/Group/Call_Center/';
                  document.documentElement.setAttribute('data-cp-path', canonical);
                }
                if (_submitNav && /\/Group\/EnterpriseTrunk\/AddUsing(?:Weighted|Ordered)Routing\/AddModify\//.test(url) &&
                    liveCell && liveCell.querySelector &&
                    liveCell.querySelector('input[name="addByWeightedRouting"], input[name="addByOrderedRouting"]')) {
                  canonical = '/commpilot/Group/EnterpriseTrunk/';
                  document.documentElement.setAttribute('data-cp-path', canonical);
                }
              } catch (e) {}
              // Tag Set Add posts to its Add URL but renders the parent tag
              // grid. Keep the address on that grid so its next Edit/Add and
              // Back navigation resolve against the correct controller.
              try {
                if (_submitNav &&
                    url === '/commpilot/Operator/System/DeviceTags/Modify/TagSet/Add/index.jsp' &&
                    liveCell && liveCell.querySelector('input[name="newTagSetName"]') &&
                    !liveCell.querySelector('input[name="tagName"]')) {
                  canonical = '/commpilot/Operator/System/DeviceTags/Modify/TagSet/index.jsp';
                  document.documentElement.setAttribute('data-cp-path', canonical);
                }
              } catch (e) {}
              // Service-instance Modify Delete returns the owning list, but
              // cpFormOrigin can be the intermediate EditRedirect page. Anchor
              // the result to the real Group list so the next Add/Edit resolves.
              try {
                if (_submitNav && params && params.delete != null && liveCell && liveCell.querySelector) {
                  if (url === '/commpilot/ServiceProvider/CommBarring/Profiles/General/index.jsp' &&
                      liveCell.querySelector('input[name="add"], select[name="findKey"]')) {
                    canonical = '/commpilot/ServiceProvider/CommBarring/Profiles/';
                  }
                  if (url === '/commpilot/User/Profile/' &&
                      liveCell.querySelector('select[name="findKey0"], input[name="findValue0"]') &&
                      !liveCell.querySelector('input[name="unicodeLastName"]') &&
                      cpFormOrigin === '/commpilot/Group/Members/') {
                    canonical = '/commpilot/Group/Members/';
                  }
                  if (url === '/commpilot/Group/Profile/' &&
                      liveCell.querySelector('select[name="findKey0"], input[name="findValue0"]') &&
                      !liveCell.querySelector('input[name="unicodeCompanyName"]') &&
                      cpFormOrigin === '/commpilot/ServiceProvider/Members/') {
                    canonical = '/commpilot/ServiceProvider/Members/';
                  }
                  var serviceList = /\/Group\/([^/]+)\/Modify\//.exec(url);
                  if (serviceList && liveCell.querySelector('input[name="addBasic"], input[name="add"]'))
                    canonical = '/commpilot/Group/' + serviceList[1] + '/' +
                      (/^(Voice_XML|InstantGroupCall)$/.test(serviceList[1]) ? 'index.jsp' : '');
                  else if (/\/Group\/Call_Center\/AddModify\//.test(url) &&
                      liveCell.querySelector('input[name="addBasic"]'))
                    canonical = '/commpilot/Group/Call_Center/';
                  if (canonical !== url) document.documentElement.setAttribute('data-cp-path', canonical);
                }
              } catch (e) {}
              // Tabbed assign pages (lowercase tabSubmit dialect): a tab switch POSTs to the CURRENT
              // tab's URL with tabPage=<relative target> and the response renders the TARGET tab.
              // Canonicalize to the target's URL or every subsequent self-post hits the WRONG tab
              // endpoint (live 2026-07-07: the Xsi Users switch posted Group fields to the SP
              // endpoint → OCI validation error 6004 / 500).
              try {
                if (/\/AssignXsiPolicyProfile\//.test(url) && params && params.tabPage) {
                  var _xm = /(ServiceProvider|Group|User)/.exec(String(params.tabPage));
                  if (_xm) {
                    canonical = url.replace(/(AssignXsiPolicyProfile)\/[A-Za-z]+\/?(index\.jsp)?$/, "$1/" + _xm[1] + "/");
                    document.documentElement.setAttribute("data-cp-path", canonical);
                  }
                }
              } catch (e) {}
              // Digit Pattern Criteria tabs use short tabPage IDs. The
              // controller redirects to a sibling page, but cpFollow returns
              // its content under the original POST URL. Anchor the visible
              // tab to its actual controller so its Action buttons submit to
              // that tab rather than to General/Modify.
              try {
                if (/^\/commpilot\/ServiceProvider\/CommBarring\/DigitPatternCriteria\//.test(url) &&
                    params && params.tabPage && liveCell) {
                  var _dpActive = (liveCell.querySelector('.tabActive')?.textContent || '').trim();
                  var _dpBase = '/commpilot/ServiceProvider/CommBarring/DigitPatternCriteria/';
                  var _dpPath = _dpActive === 'Digit Patterns' ? _dpBase + 'DigitPatterns/' :
                    _dpActive === 'Usage' ? _dpBase + 'Usage/' :
                    _dpActive === 'General' ? _dpBase + 'Modify/index.jsp' : '';
                  if (_dpPath) {
                    canonical = _dpPath;
                    document.documentElement.setAttribute('data-cp-path', canonical);
                  }
                }
              } catch (e) {}
              // Alerting must be entered through the Executive controller, but
              // the painted tab belongs at its own path for later relative
              // actions and Back/Forward replay.
              try {
                if (/^\/commpilot\/User\/Executive\/?$/.test(url) &&
                    params && params.tabPage === '/commpilot/User/Executive/Alerting/' &&
                    liveCell && /Alerting/.test(liveCell.querySelector('.tabActive')?.textContent || '')) {
                  canonical = params.tabPage;
                  document.documentElement.setAttribute('data-cp-path', canonical);
                }
              } catch (e) {}
              try {
                // The entry was created before script replay. A list/form/tab
                // response may have a different canonical URL; update that
                // same entry without adding another Back step.
                if (cpHistoryCommitted || cpHistoryMode === "replace")
                  history.replaceState(cpState, "", canonical);
                else history.pushState(cpState, "", canonical);
                cpPopReplaying = false;
              } catch (e) {}
              // Chained follow-up (entity re-entry → target page): fire the pending nav now that this swap
              // (the entry) has committed. See cpPendingNav/cpEntityEntry.
              try {
                if (cpPendingNav) { var _pn = cpPendingNav; cpPendingNav = null;
                  if (_pn.replace) cpAutoReplaceUrl = _pn.url;
                  setTimeout(function () { cpHook(_pn.url, _pn.params || {}); }, 0); }
              } catch (e) {}
            })
            .catch(function (e) {
              // GENUINE NETWORK-LEVEL failure (the request threw, vs a server response). Since cpFollow uses
              // redirect:"manual", a server LOGIN BOUNCE (302 → http:// Login, CSP-blocked as mixed content) now
              // resolves as an opaqueredirect → {auth:false} and NO LONGER reaches here — so a throw here is a
              // real dropped socket, not a masquerading CSP block. The usual cause after idle: the server /
              // load-balancer closed the persistent keep-alive socket, so the FIRST fetch on the stale connection
              // throws "TypeError: Failed to fetch" — the POST never reached the server, so the nav silently died
              // ("dead click after idle"). The raw site dodges this because its full-page form POSTs transparently
              // reconnect; our fetch() does not. Retry ONCE on a fresh connection (a new
              // fetch opens a new socket) before giving up. SAFE for saves too: a connection that failed before
              // the request was processed can't have double-applied it. A real server response — including a
              // genuine auth failure ({auth:false}) — resolves through .then above and never reaches here, so the
              // retry can't mask a real logout. Guarded by _retry so it can never loop.
              var _msg = String((e && e.message) || e || "");
              var isNetErr = !!e && (e.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(_msg));
              if (isNetErr && !_retry) {
                console.warn("[pjax] fetch network error (dropped idle connection?) — retrying nav once on a fresh connection");
                setTimeout(function () { try { cpHook(url, params, true); } catch (e2) {} }, 200);
                return;
              }
              cpWarnCo("failed|" + url + "|" + _msg, "[pjax] fetch FAILED " + _msg + " (" + url + ")");
            });

          return; // do NOT call _orig — no navigation for menu navs
        }
      } catch (e) {}
      return _orig.apply(this, arguments);
    };

    window.redirectPost = cpHook;

    // Known multipart servlets accept POSTs and answer with a token-bearing
    // redirectPost stub. Keep the file POST in the current document, then let
    // cpHook follow that stub and repaint the resulting CommPilot page.
    var cpUploadActive = false;
    function cpImportUploadAction(form) {
      if (!form || !/multipart\/form-data/i.test(form.getAttribute('enctype') || '') ||
          (form.getAttribute('method') || 'GET').toUpperCase() !== 'POST') return null;
      var target = (form.getAttribute('target') || '').toLowerCase();
      if (target && target !== '_self') return null;
      try {
        var action = new URL(form.getAttribute('action') || location.pathname, location.href);
        var deviceProfile = action.pathname === '/commpilot/servlet/DeviceInventoryProvisionServlet';
        var mohUser = action.pathname === '/commpilot/servlet/MusicOnHoldUserServlet';
        var mohGroup = action.pathname === '/commpilot/servlet/MusicOnHoldServlet';
        var callCenterAnnouncements = /^\/commpilot\/servlet\/CallCenterAnnouncements[A-Za-z]*Servlet$/.test(action.pathname);
        var groupAudioSettings = /^\/commpilot\/servlet\/(?:PreAlertingAnnouncement(?:Group|User)|CustomRingback(?:Group|User))Servlet$/.test(action.pathname);
        var vpBranding = action.pathname === '/commpilot/servlet/VPBrandingServlet';
        var autoAttendantMenu = action.pathname === '/commpilot/servlet/AASubscriptionServlet';
        var callCenterRouting = /^\/commpilot\/servlet\/CallCenter(?:Overflow|StrandedCalls(?:Unavailable)?)RoutingPolicyServlet$/.test(action.pathname);
        if (!form.querySelector('input[type="file"]') && !deviceProfile && !mohUser && !mohGroup && !callCenterAnnouncements && !groupAudioSettings && !vpBranding && !autoAttendantMenu && !callCenterRouting) return null;
        return action.origin === location.origin &&
          (/^\/commpilot\/servlet\/(?:DeviceManagementImportServlet|PhoneListImportServlet|AnswerConfirmationServlet|VPBrandingServlet|SysAdminPrefsServlet|CCReportBrandingServlet|InterceptServiceServlet|AnnouncementRepositoryServlet|CallCenterEnhancedReportingReportTemplateServlet|SystemDmsFileProvisionServlet|DeviceInventoryProvisionServlet|MusicOnHoldUserServlet|MusicOnHoldServlet|PreAlertingAnnouncementGroupServlet|PreAlertingAnnouncementUserServlet|CustomRingbackGroupServlet|CustomRingbackUserServlet|AASubscriptionServlet)$/.test(action.pathname) || callCenterAnnouncements || callCenterRouting) ? action : null;
      } catch (e) { return null; }
    }
    function cpUploadNotice(message) {
      var cell = document.querySelector('td[width="82%"]');
      if (!cell) { console.warn('[pjax] upload: ' + message); return; }
      var old = cell.querySelector('.cp-upload-notice');
      if (old) old.remove();
      var notice = document.createElement('div');
      notice.className = 'cp-alert cp-alert-error cp-upload-notice';
      notice.textContent = message;
      cell.insertBefore(notice, cell.firstChild);
    }
    function cpSubmitImportUpload(form, submitter) {
      var action = cpImportUploadAction(form);
      if (!action) return false;
      if (cpUploadActive) return true;
      cpUploadActive = true;
      if (cpAggActive) { cpSectionAborted = true; cpAggEnd(); }
      try { if (cpGridState && cpGridState._searchAbort) cpGridState._searchAbort.abort(); } catch (e) {}
      try { if (cpGridState && cpGridState._sweepAbort) cpGridState._sweepAbort.abort(); } catch (e) {}
      var uploadSeq = ++cpSeq; // discard a late navigation response instead of overwriting the upload result
      var body = new FormData(form);
      if (submitter && submitter.name) body.append(submitter.name, submitter.value || '');
      var buttons = [].slice.call(form.querySelectorAll('[type="submit"]'));
      buttons.forEach(function (button) { button.disabled = true; });
      form.setAttribute('aria-busy', 'true');
      var finished = false;
      function release(message) {
        if (finished) return;
        finished = true; cpUploadActive = false;
        buttons.forEach(function (button) { button.disabled = false; });
        form.removeAttribute('aria-busy');
        if (message) cpUploadNotice(message);
      }
      var waited = 0;
      function sendWhenReady() {
        if (cpSeq !== uploadSeq || !form.isConnected) { release(); return; }
        if (cpInflightPosts > 0) {
          if (waited++ < 250) { setTimeout(sendWhenReady, 20); return; }
          release('Another page request is still running. Please try the upload again.');
          return;
        }
        var liveToken = document.getElementsByName('formtokenserial')[0];
        if (liveToken) body.set('formtokenserial', liveToken.value);
        cpInflightPosts++;
        fetch(action.href, { method: 'POST', body: body, credentials: 'same-origin', redirect: 'manual' })
          .then(function (response) {
            if (response.status >= 500) {
              release('The server could not process the upload. No automatic retry was sent.');
              return null;
            }
            if (response.type === 'opaqueredirect' || response.status === 0 || response.status >= 300) {
              release('The upload could not continue because the session ended. Please sign in again.');
              return null;
            }
            return response.text();
          })
          .then(function (html) {
            if (html == null) return;
            if (cpSeq !== uploadSeq) { release(); return; }
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var stub = cpExtractStub(doc);
            if (!stub || !stub.target || !isPjaxUrl(stub.target)) {
              release('The upload was sent, but its result could not be displayed. Reload to inspect it.');
              return;
            }
            if (stub.token) {
              var tokens = document.getElementsByName('formtokenserial');
              for (var i = 0; i < tokens.length; i++) tokens[i].value = stub.token;
            }
            document.addEventListener('cp:reskin', function () { release(); }, { once: true });
            cpHook(stub.target, stub.data || {});
            setTimeout(function () {
              if (cpUploadActive) release('The upload was sent, but its result did not appear. Check before trying again.');
            }, 15000);
          })
          .catch(function (error) {
            console.warn('[pjax] upload request failed:', error);
            release('The upload response was lost. Check the result before trying again.');
          })
          .then(function () { cpInflightPosts = Math.max(0, cpInflightPosts - 1); },
            function () { cpInflightPosts = Math.max(0, cpInflightPosts - 1); });
      }
      sendWhenReady();
      return true;
    }

    // Tag Set Add's legacy OK handler calls a native submit before the shared
    // submit listener can own the request. Filtered list grids sit at
    // Common/find.jsp, although their Apply/OK still belongs to the list's
    // returnPage controller. Post those actions there through PJAX.
    document.addEventListener("click", function (e) {
      try {
        var tagAdd = location.pathname ===
          "/commpilot/Operator/System/DeviceTags/Modify/TagSet/Add/index.jsp";
        var filteredTags = /\/commpilot\/Common\/find(?:All)?\.jsp$/.test(location.pathname) &&
          !!document.querySelector('td[width="82%"] input[name="newTagSetName"]');
        var returnPage = history.state && history.state.cpNav && history.state.cpNav.params &&
          history.state.cpNav.params.returnPage;
        var filteredOwner = /\/commpilot\/Common\/find(?:All)?\.jsp$/.test(location.pathname) &&
          !filteredTags && typeof returnPage === 'string' &&
          /^\/(?:Reseller|ServiceProvider|Group|User|Operator)\/[A-Za-z0-9_/-]+\/$/.test(returnPage) &&
          !!document.querySelector('td[width="82%"] input[name^="hiddenCheckbox_"]') ?
          '/commpilot' + returnPage : null;
        if (!tagAdd && !filteredTags && !filteredOwner) return;
        var button = e.target && e.target.closest ?
          e.target.closest(tagAdd ? 'input[type="submit"][name="ok"]' :
            'input[type="submit"][name="ok"], input[type="submit"][name="apply"]') : null;
        if (!button || !button.form) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var entries = [], params = {};
        new FormData(button.form, button).forEach(function (value, name) {
          if (value instanceof File) return;
          entries.push([name, value]);
          params[name] = value;
        });
        params.__cpFormEntries = entries;
        cpHook(tagAdd ? location.pathname : filteredOwner ? filteredOwner :
          '/commpilot/Operator/System/DeviceTags/Modify/TagSet/index.jsp', params);
      } catch (err) { console.warn("[pjax] Tag Set Add submit", err); }
    }, true);

    // Communication Barring Profile search rows wire their default-profile
    // checkbox in a DOMContentLoaded callback. A PJAX-filled Find result can
    // display the checkbox without that callback, leaving profileSelected
    // empty even while the box appears checked.
    document.addEventListener("change", function (e) {
      try {
        if (!/\/commpilot\/Common\/find(?:All)?\.jsp$/.test(location.pathname) ||
            !history.state || !history.state.cpNav || !history.state.cpNav.params ||
            history.state.cpNav.params.tableName !== 'spCBProfileTable') return;
        var cb = e.target;
        if (!cb || !cb.matches ||
            !cb.matches('td[width="82%"] input[type="checkbox"][name^="checkbox___DFLT_COL_ID____DELIMITER__"]')) return;
        var selected = cb.form && cb.form.querySelector('input[name="profileSelected"]');
        if (selected) selected.value = cb.checked ? cb.id : '';
      } catch (err) { console.warn("[pjax] profile selection", err); }
    }, true);

    document.addEventListener("submit", function (e) {
      try {
        var form = e.target;
        if (!form || form.tagName !== "FORM") return;
        if (cpImportUploadAction(form)) {
          e.preventDefault(); e.stopImmediatePropagation();
          cpSubmitImportUpload(form, e.submitter);
          return;
        }
        // Resolve the POST target from the ATTRIBUTE, not the form.action DOM property. Legacy forms (e.g. the
        // admin Modify mainForm) carry a hidden <input name="action">, which SHADOWS form.action → reading it
        // returns that ELEMENT, not a URL string, so isPjaxUrl(form.action) was always false and the submit fell
        // through to a NATIVE full POST (rotated single-use token → "page temporarily unavailable" → /Login/).
        // An empty action attribute means "post to self" → fall back to the current path.
        var act = form.getAttribute("action"); if (!act) act = location.pathname;
        try { var resolvedAct = new URL(act, location.href); act = resolvedAct.pathname + resolvedAct.search; } catch (e) {}
        // The admin drill-in lands the URL on modify.jsp (the set-context endpoint); the form's REAL save endpoint
        // is .../Admins/Modify/. An empty action posts to self = modify.jsp, which only RE-RENDERS (no save — the
        // "OK does nothing, breadcrumb just refreshes" symptom). Verified live that posting the same fields to
        // Modify/ saves and returns to the list. Redirect the self-post there (covers OK and Delete).
        if (/\/(Reseller|ServiceProvider|Group)\/Admins\/modify\.jsp$/i.test(act))
          act = act.replace(/\/modify\.jsp$/i, '/Modify/');
        // Enterprise Trunk's generic Modify/index.jsp only selects the trunk
        // and redirects to the routing controller. A self-POST loses the
        // clicked save/delete action on that redirect (a native Delete also
        // re-rendered Modify without removing the disposable sandbox trunk).
        // Submit final actions to the controller that owns this routing type.
        if (/^\/commpilot\/Group\/EnterpriseTrunk\/Modify\/index\.jsp$/i.test(act) &&
            e.submitter && /^(ok|apply|delete)$/i.test(e.submitter.name || '')) {
          var trunkTypeEl = form.querySelector('[name="enterpriseTrunkType"]');
          var trunkType = String(trunkTypeEl && trunkTypeEl.value || '').toLowerCase();
          if (trunkType === 'weighted' || trunkType === 'ordered')
            act = '/commpilot/Group/EnterpriseTrunk/AddUsing' +
              (trunkType === 'weighted' ? 'Weighted' : 'Ordered') + 'Routing/AddModify/';
        }
        if (!isPjaxUrl(act)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var params = {}, entries = [];
        var fields = e.submitter ? new FormData(form, e.submitter) : new FormData(form);
        fields.forEach(function (value, name) {
          if (name === 'formtokenserial') { entries.push([name, value]); return; }
          if (value instanceof File) return;
          entries.push([name, value]);
          params[name] = value;
        });
        // A map collapses duplicate hidden controls (for example, Routing
        // Priority's two buttonClicked fields). CommPilot validates the native
        // browser form shape, so keep every successful control in DOM order.
        params.__cpFormEntries = entries;
        cpHook(act, params);
      } catch (err) { console.warn("[pjax] submit intercept", err); }
    }, true);

    // CommPilot also calls form.submit() directly from some page scripts.
    // That bypasses submit events, including the PJAX listener above. Replay
    // ordinary content forms through that listener; the two known import
    // servlets use multipart PJAX above. Keep other uploads, downloads, and
    // hidden transport frames on their native path.
    var cpNativeFormSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      try {
        if (cpImportUploadAction(this)) { cpSubmitImportUpload(this, null); return; }
        var action = new URL(this.getAttribute("action") || location.pathname, location.href);
        var target = (this.getAttribute("target") || "").toLowerCase();
        var enctype = (this.getAttribute("enctype") || "").toLowerCase();
        var configFiles = "/commpilot/Group/DefaultConfig/Nested/Files/";
        if (action.pathname === configFiles && location.pathname === configFiles) return;
        if (this.isConnected && action.origin === location.origin &&
            (this.getAttribute("method") || "GET").toUpperCase() === "POST" &&
            (!target || target === "_self") && !/multipart\/form-data/.test(enctype) &&
            !this.querySelector('input[type="file"]') &&
            isPjaxUrl(action.pathname + action.search)) {
          if (action.pathname === configFiles) {
            // The list grid may replay its own DOMContentLoaded handlers while
            // harvesting rows. Those synthetic calls must not consume the real
            // automatic forward that follows the page swap.
            if (cpDclSpin) return;
            if (cpConfigFilesForwarded) return;
            cpConfigFilesForwarded = true;
          }
          // Configuration's auto-forward runs in a replayed DOMContentLoaded
          // callback, after reexecScripts has returned. Keep the intermediate
          // Configuration page out of Back history in that case too.
          if (cpReexecutingScripts || (action.pathname === configFiles &&
              /\/DefaultConfig\/Nested\/Configuration\//.test(location.pathname)))
            cpAutoReplaceUrl = action.pathname + action.search;
          var submitEvent = new Event("submit", { bubbles: true, cancelable: true });
          this.dispatchEvent(submitEvent);
          if (submitEvent.defaultPrevented) return;
          if (action.pathname === configFiles) cpConfigFilesForwarded = false;
        }
      } catch (e) { console.warn("[pjax] direct submit bridge", e); }
      return cpNativeFormSubmit.apply(this, arguments);
    };

    // The legacy "Cancel" on the admin Modify page returns via a server-side context our pjax nav doesn't
    // preserve, so it lands on the WRONG list (observed: -> /Reseller/Enterprises/ -> 404, then a logout on the
    // error page's recovery). Override it: on the admin Modify page, Cancel goes straight back to the
    // Administrators list via pjax (clean swap). Capturing + stopImmediatePropagation pre-empts the legacy handler
    // whatever it does. (The redesign wires its own Cancel the same way — this is the real navigate-out wiring.)
    document.addEventListener("click", function (e) {
      try {
        // Forms whose legacy Cancel returns via a server-side context our pjax nav doesn't preserve (or whose
        // Cancel is a DCL-wired type=button that doesn't survive an in-shell swap) — route Cancel straight to the
        // owning /Reseller list. Covers the admin Add/Modify AND the Operator/System DeviceType Add/Modify forms.
        var _p = location.pathname, _list = null;
        if (/\/Reseller\/Admins\/(Add|[Mm]odify)/.test(_p)) _list = "/commpilot/Reseller/Admins/";
        else if (/\/(ServiceProvider|Group)\/(DialableCallerID|Carriers|IMRNsManagement)\/(Add|[Mm]odify)/.test(_p)) _list = _p.replace(/(DialableCallerID|Carriers|IMRNsManagement)\/.*$/, "$1/");
        else { var _dm = _p.match(/\/commpilot\/Operator\/System\/(DeviceType)\/(?:Add|[Mm]odify|Profile)\//); if (_dm) _list = "/commpilot/Reseller/" + _dm[1] + "/"; }
        if (!_list) {
          // Assign-picker + tabbed assign pages: Cancel's goBack() is DCL-wired (dead after an
          // in-shell swap) and the return context is history anyway — go back in-shell.
          if (/\/Operator\/ServiceProviders\/Assign/.test(_p) || /\/(ServiceProvider|Group)\/AssignXsiPolicyProfile\//.test(_p)) {
            var ttA = e.target;
            var btnA = ttA && (ttA.name === "cancel" ? ttA : (ttA.closest ? ttA.closest('input[name="cancel"]') : null));
            if (!btnA) return;
            e.preventDefault(); e.stopImmediatePropagation();
            window.history.back();
          }
          return;
        }
        var tt = e.target;
        var btn = tt && (tt.name === "cancel" ? tt : (tt.closest ? tt.closest('input[name="cancel"], button[name="cancel"]') : null));
        if (!btn) return;
        e.preventDefault(); e.stopImmediatePropagation();
        cpDbg("[pjax] form Cancel -> list", _list);
        window.redirectPost(_list, {});
      } catch (err) {}
    }, true);

    // Assign-picker pages (Assign Domains & family): the 4 move buttons are DCL-wired
    // (getElementById(button_<uuid>).addEventListener → addDomain/removeDomain/… → form.submit()),
    // which BOTH dies after an in-shell swap AND native-POSTs on a full load. Re-wire them here:
    // replicate the Scripts/domains.js protocol (toAdd/toRemove = comma-joined selected option
    // VALUES; action = add/remove; assigned values ending "*" are the default domain and can't be
    // removed) and requestSubmit() so the submit interceptor above replays it in-shell. Capturing +
    // stopImmediatePropagation pre-empts the legacy listener when it IS alive (full load) so the
    // move can't double-submit.
    document.addEventListener("click", function (e) {
      try {
        var form = document.forms.mainForm;
        if (!form || !form.elements.toAdd || !form.elements.availableList) return;
        var t = e.target;
        var b = t && t.closest ? t.closest('input[type="button"]') : null;
        if (!b) return;
        var label = (b.value || "").replace(/\s+/g, " ").trim();
        var all = /All/i.test(label);
        var isAdd = /^Add/i.test(label), isRem = /^Remove/i.test(label);
        if (!isAdd && !isRem) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var list = isAdd ? form.elements.availableList : form.elements.assignedList;
        if (!list) return;
        var vals = [];
        for (var i = 0; i < list.options.length; i++) {
          var o = list.options[i];
          if (!all && !o.selected) continue;
          var v = o.value || "";
          if (!v.trim()) continue;
          if (isRem && v.charAt(v.length - 1) === "*") continue;   // default domain — not removable
          vals.push(v);
        }
        if (!vals.length) return;
        form.elements[isAdd ? "toAdd" : "toRemove"].value = vals.join(",");
        form.elements.action.value = isAdd ? "add" : "remove";
        form.requestSubmit();
      } catch (err) { console.warn("[pjax] assign-pick move", err); }
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
        cpDbg("[pjax] reload intercepted → native reload (grid active, GET-safe)");
        try { location.reload(); } catch (e3) { try { location.href = location.href; } catch (e4) {} }
        return;
      }
      // Fall back to the persisted cp-last-nav (sessionStorage) before the reseller-home default: after a
      // reload-button recovery the page is fresh, so the in-memory cpLastNav is null even though we ARE deep
      // in an SP/group/user — without this, F5 right after the reload button jumps all the way to reseller.
      var nav = cpLastNav;
      if (!nav) { try { nav = JSON.parse(sessionStorage.getItem("cp-last-nav") || "null"); } catch (e) {} }
      if (!nav || !nav.url) nav = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
      cpDbg("[pjax] reload intercepted → replay", nav.url);
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
        if ((!nav || !nav.url) && cpSearchLandingNav &&
            location.pathname === cpSearchLanding &&
            document.documentElement.getAttribute("data-cp-path") !== location.pathname) {
          nav = cpSearchLandingNav;
          cpDbg("[pjax] popstate missing state → replay search landing", nav.url);
        }
        if (!nav || !nav.url) return;
        cpPopReplaying = true;
        cpPopScroll = typeof e.state?.cpMainScroll === "number" ? e.state.cpMainScroll : 0;
        cpDbg("[pjax] popstate → replay", nav.url);
        // A child page can switch CommPilot's server-side target (for example,
        // User Addresses → Group device profile). Restore the entry context
        // before replaying the previous page, keeping the Back entry in place.
        var painted = document.documentElement.getAttribute("data-cp-path") || "";
        var scope = function (path) { return /^\/commpilot\/([^/]+)/.exec(path || "")?.[1] || ""; };
        if (nav.entry && nav.entry.url && nav.entry.url !== nav.url &&
            scope(painted) && scope(nav.url) && scope(painted) !== scope(nav.url)) {
          cpPendingNav = { url: nav.url, params: nav.params || {}, replace: true };
          window.redirectPost(nav.entry.url, nav.entry.params || {});
        } else window.redirectPost(nav.url, nav.params || {});
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
          cpDbg("[pjax] auto-return →", last.url, last.params);
          setTimeout(function () {
            try {
              // A fresh login's server context is HOME — re-enter the entity first when the saved nav is
              // entity-scoped, then chain to the page (cpPendingNav). Direct replay alone → "no target object".
              if (last.entry && last.entry.url && last.entry.url !== last.url) {
                cpPendingNav = { url: last.url, params: last.params || {} };
                window.redirectPost(last.entry.url, last.entry.params || {});
              } else {
                window.redirectPost(last.url, last.params || {});
              }
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

    // Reseller option paths with an inline Peek. Their pages are read through the
    // same token-bearing PJAX transport used for normal navigation.
    var CP_LEAF_ALLOW_BY_LEVEL = {
      R: ["/Reseller/Profile/", "/Reseller/DeviceActivationPolicy/", "/Reseller/StirShaken/", "/Reseller/CallRecordingPlatforms/",
        "/Reseller/CallNotify/", "/Reseller/Collaborate/", "/Reseller/EmergencyZone/", "/Reseller/VM/",
        "/Reseller/CallCenter/", "/Reseller/MeetMeConferencing/", "/Reseller/EmergencyCallNotification/", "/Reseller/MailParameters/"],
      G: ["/Group/EmergencyCallNotification/", "/Group/ExtensionMgmt/",
        "/Group/DeviceActivationPolicy/", "/Group/Call_Center/ExternalReporting/"],
      U: ["/User/ACR/", "/User/DND/", "/User/CW/", "/User/RemoteOffice/",
        "/User/CF/Always/", "/User/CF/Busy/", "/User/CF/Not_Reachable/", "/User/VoicePortalCalling/"]
    };
    // The known multi-value pages need matching placeholder rows so a late read
    // does not resize the menu option while someone is scanning the board.
    var CP_LEAF_RESERVED_ROWS = {
      "/Reseller/Profile/": 2,
      "/Reseller/CallRecordingPlatforms/": 2,
      "/Reseller/VM/": 3,
      "/Group/EmergencyCallNotification/": 2,
      "/Group/ExtensionMgmt/": 3,
      "/Group/DeviceActivationPolicy/": 3,
      "/User/DND/": 2,
      "/User/CW/": 2,
      "/User/RemoteOffice/": 2,
      "/User/CF/Always/": 3,
      "/User/CF/Busy/": 2,
      "/User/CF/Not_Reachable/": 2
    };
    // Notification-email labels follow each form's input order. Voice Messaging
    // has three fields; the other notification forms have one.
    var CP_LEAF_NOTIFY = {
      "/Reseller/CallNotify/": ["Default from"],
      "/Reseller/Collaborate/": ["Default from"],
      "/Reseller/EmergencyZone/": ["Default from"],
      "/Reseller/VM/": ["Delivery", "Notification", "Passcode lockout"],
      "/Reseller/CallCenter/": ["Default from"],
      "/Reseller/MeetMeConferencing/": ["Default from"],
      "/Reseller/EmergencyCallNotification/": ["Default from"],
      "/Reseller/MailParameters/": ["Default from"]
    };
    // Verbatim Tabler outline glyphs for the source pill (MAIN world has no webfont/asset urls → inline SVG).
    var CP_SVG_SRC_SYS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l-8 4l8 4l8 -4l-8 -4"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/></svg>';
    var CP_SVG_SRC_RES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M6 4v4"/><path d="M6 12v8"/><path d="M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M12 4v10"/><path d="M12 18v2"/><path d="M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M18 4v1"/><path d="M18 9v11"/></svg>';

    // Glance-pill action glyphs (Tabler outline, inline — MAIN world has no webfont).
    var CP_SVG_LEAF_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/></svg>';
    var CP_SVG_LEAF_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/></svg>';
    var CP_SVG_LEAF_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5l10 -10"/></svg>';
    var CP_SVG_LEAF_XX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>';

    // Inline glance-pill editor (Option B, 2026-07-02): the pencil swaps the pill for an input; Enter/✓ saves
    // via cpLeafSave, Esc/✕ cancels. All events stop propagation so the surrounding menu-card nav never fires.
    function cpLeafEdit(pill, acts, r) {
      if (pill.__cpEditing) return;
      pill.__cpEditing = true;
      var isChoice = r.edit && (r.edit.type === "radio" || r.edit.type === "checkbox");
      var old = isChoice ? (r.value === "On" ? "true" : "false") : (r.empty ? "" : pill.textContent);
      var wrap = pill.parentNode;
      var inp = document.createElement(isChoice ? "select" : "input");
      inp.className = "cp-leaf-editin";
      if (isChoice) {
        [["true", "On"], ["false", "Off"]].forEach(function (pair) {
          var option = document.createElement("option"); option.value = pair[0]; option.textContent = pair[1]; inp.appendChild(option);
        });
        inp.setAttribute("aria-label", "Set " + r.label);
      } else inp.type = "text";
      inp.value = old;
      var okB = document.createElement("button");
      okB.type = "button"; okB.className = "cp-leaf-actbtn cp-leaf-act-ok"; okB.title = "Save"; okB.innerHTML = CP_SVG_LEAF_CHECK;
      var noB = document.createElement("button");
      noB.type = "button"; noB.className = "cp-leaf-actbtn cp-leaf-act-no"; noB.title = "Cancel"; noB.innerHTML = CP_SVG_LEAF_XX;
      pill.classList.add("cp-leaf-hidden"); acts.classList.add("cp-leaf-hidden");   // class, not inline style — the base rules are !important
      wrap.classList.add("cp-leaf-editing");
      wrap.appendChild(inp); wrap.appendChild(okB); wrap.appendChild(noB);
      inp.focus(); if (!isChoice) inp.select();
      function done() {
        try { inp.remove(); okB.remove(); noB.remove(); } catch (e) {}
        pill.classList.remove("cp-leaf-hidden"); acts.classList.remove("cp-leaf-hidden");
        wrap.classList.remove("cp-leaf-editing"); pill.__cpEditing = false;
      }
      function flash(cls) { pill.classList.add(cls); setTimeout(function () { pill.classList.remove(cls); }, 1600); }
      function save(ev) {
        if (ev) { ev.stopPropagation(); ev.preventDefault(); }
        var nv = inp.value.trim();
        if (nv === old) { done(); return; }
        inp.disabled = true; okB.disabled = true; noB.disabled = true;
        cpLeafSave(r.edit, nv).then(function (good) {
          done();
          if (good) {
            var display = isChoice ? (nv === "true" ? "On" : "Off") : (nv || "None");
            pill.textContent = display;
            pill.title = display;
            pill.classList.toggle("cp-leaf-defpill-empty", !isChoice && !nv);
            r.empty = !isChoice && !nv; r.value = display;
            flash("cp-leaf-savedflash");
          } else {
            flash("cp-leaf-failflash");
          }
        });
      }
      function cancel(ev) { if (ev) { ev.stopPropagation(); ev.preventDefault(); } done(); }
      okB.addEventListener("click", save);
      noB.addEventListener("click", cancel);
      inp.addEventListener("click", function (ev) { ev.stopPropagation(); });
      inp.addEventListener("keydown", function (ev) {
        ev.stopPropagation();
        if (ev.key === "Enter") { ev.preventDefault(); save(); }
        else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
      });
    }

    function cpLeafMatches(doc, edit, value) {
      var form = doc && doc.querySelector('form[name="mainForm"]');
      if (!form) return false;
      var type = edit.type || "text";
      var fields = [].slice.call(form.querySelectorAll("input")).filter(function (el) {
        return el.name === edit.name && el.type === type;
      });
      if (type === "radio") {
        var selected = fields.find(function (el) { return el.checked || el.hasAttribute("checked"); });
        return !!selected && selected.value === value;
      }
      if (type === "checkbox") return fields.length === 1 && !!(fields[0].checked || fields[0].hasAttribute("checked")) === (value === "true");
      return fields.length === 1 && (fields[0].value || "").trim() === value;
    }

    // Background save for a glance-pill edit: fetch the page fresh (fresh token + full form), swap in the new
    // value, POST with apply="Apply" (saves WITHOUT the OK page-exit, so the response is the page itself and
    // the new value can be verified). Serialized through the section queue — token-rotating calls never race.
    function cpLeafSave(edit, newValue) {
      return new Promise(function (resolve) {
        cpEnqueueSection(function () {
          var tokEl = document.getElementsByName("formtokenserial")[0];
          var token = tokEl ? tokEl.value : null;
          return cpFollow(edit.path, {}, token, 0).then(function (res) {
            if (!res || res.auth === false || res.err || !res.doc) { resolve(false); return; }
            var nt = res.doc.getElementsByName("formtokenserial")[0];
            if (nt) { var ts = document.getElementsByName("formtokenserial"); for (var i = 0; i < ts.length; i++) ts[i].value = nt.value; }
            var form = res.doc.querySelector('form[name="mainForm"]');
            if (!form || form.querySelector('input[type="password"], input[type="file"]') || !form.querySelector('[name="apply"]')) {
              resolve(false); return;
            }
            var type = edit.type || "text";
            var sourceInputs = [].slice.call(form.getElementsByTagName("input")).filter(function (el) { return el.name === edit.name && el.type === type; });
            if ((type === "radio" && (sourceInputs.length !== 2 || !sourceInputs.some(function (el) { return el.value === newValue; }))) ||
              (type !== "radio" && sourceInputs.length !== 1)) { resolve(false); return; }
            var params = {};
            [].slice.call(form.querySelectorAll("input, select, textarea")).forEach(function (el) {
              if (!el.name) return;
              var t = (el.type || "").toLowerCase();
              if (t === "button" || t === "submit" || t === "image") return;
              if ((t === "checkbox" || t === "radio") && !(el.checked || el.hasAttribute("checked"))) return;
              params[el.name] = el.value || "";
            });
            delete params.formtokenserial;   // cpFollow threads the (just-refreshed) live token
            if (type === "checkbox") {
              if (newValue === "true") params[edit.name] = sourceInputs[0].value || "on";
              else delete params[edit.name];
            } else params[edit.name] = newValue;
            params.apply = "Apply";
            var tok2 = document.getElementsByName("formtokenserial")[0];
            return cpFollow(edit.path, params, tok2 ? tok2.value : null, 0).then(function (res2) {
              if (!res2 || res2.auth === false || res2.err || !res2.doc) { resolve(false); return; }
              var nt2 = res2.doc.getElementsByName("formtokenserial")[0];
              if (nt2) { var ts2 = document.getElementsByName("formtokenserial"); for (var j = 0; j < ts2.length; j++) ts2[j].value = nt2.value; }
              if (!cpLeafMatches(res2.doc, edit, newValue)) { resolve(false); return; }
              var tok3 = document.getElementsByName("formtokenserial")[0];
              return cpFollow(edit.path, {}, tok3 ? tok3.value : null, 0).then(function (res3) {
                if (!res3 || res3.auth === false || res3.err || !res3.doc) { resolve(false); return; }
                var nt3 = res3.doc.getElementsByName("formtokenserial")[0];
                if (nt3) { var ts3 = document.getElementsByName("formtokenserial"); for (var k = 0; k < ts3.length; k++) ts3[k].value = nt3.value; }
                resolve(cpLeafMatches(res3.doc, edit, newValue));
              });
            });
          }).catch(function () { resolve(false); });
        });
      });
    }

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
              var compact = cpReadCompactLeaf(cell, path);
              if (compact !== undefined) { resolve(compact); return; }
              // Some LIST pages expose pre-list default settings (Call Recording Platforms' System/Reseller
              // Default) — surface those as the card glance even though the page is a list (so it must run
              // BEFORE the leaf-only list-guard below). Reuse the grid's own defaults harvester; a present
              // value → lavender pill, an empty default → a dashed "None" pill (mirrors the list strip).
              if (/\/CallRecordingPlatforms\//.test(path)) {
                var crpDefs = cpGridHarvestSettings(cell);
                if (!crpDefs || !crpDefs.length) { resolve(null); return; }
                resolve(crpDefs.map(function (s) {
                  var has = !!(s.value && s.value.trim());
                  return {
                    label: s.label.replace(/\s*Call Recording Platform\s*$/i, "").trim(),
                    value: has ? s.value.trim() : "None",
                    kind: "defpill",
                    empty: !has
                  };
                }));
                return;
              }
              // Notification-email family: harvest the text inputs in DOM order and label them per the page's
              // CP_LEAF_NOTIFY spec — the legacy rows all share the SAME label ("Default From Email Address:"),
              // so the generic label:value parser below can't produce useful per-row labels for VM's 3 fields.
              var nfLabels = null;
              for (var nfk in CP_LEAF_NOTIFY) { if (path.indexOf(nfk) !== -1) { nfLabels = CP_LEAF_NOTIFY[nfk]; break; } }
              if (nfLabels) {
                var nfIns = cell.querySelectorAll('input[type="text"]');
                if (!nfIns.length) { resolve(null); return; }
                // Inline edit rides the input NAME — only offered when the name is unique in the form (params
                // are name-keyed; a duplicate name would clobber a sibling field on save).
                var nfNames = {};
                for (var nn = 0; nn < nfIns.length; nn++) { var nm = nfIns[nn].name || ""; if (nm) nfNames[nm] = (nfNames[nm] || 0) + 1; }
                var nfRows = [];
                for (var ni = 0; ni < nfIns.length && ni < 4; ni++) {
                  var nfv = (nfIns[ni].value || "").trim();
                  var nfnm = nfIns[ni].name || "";
                  nfRows.push({
                    label: nfLabels[ni] || "Default from", value: nfv || "None", kind: "defpill", empty: !nfv,
                    edit: (nfnm && nfNames[nfnm] === 1) ? { path: path, name: nfnm } : null
                  });
                }
                resolve(nfRows); return;
              }
              // Verify leaf-like: not a list (no search/results table)
              if (cell.querySelector('#searchTable, #resultsTable, input[name="searchString"]')) { resolve(null); return; }
              // Settings-source pages (Activation Code / STIR-SHAKEN) express the loaded policy as a
              // useSystemSettings radio, not label:value rows — surface it as ONE glance row with a pill.
              var srcSysR = cell.querySelector('input[name="useSystemSettings"][value="true"]');
              var srcResR = cell.querySelector('input[name="useSystemSettings"][value="false"]');
              if (srcSysR || srcResR) {
                var useSys = !!(srcSysR && (srcSysR.checked || srcSysR.hasAttribute("checked")));
                resolve([{ label: "Settings source", value: useSys ? "System" : "Reseller", pill: useSys ? "sys" : "res" }]);
                return;
              }
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
                // defpill (lavender value pill) — the console-wide glance style (user: make Profile match the
                // CRP/email cards; the old plain-text .cp-leaf-val rendering predated the pill standard).
                out.push({ label: label.replace(/:\s*$/, ""), value: val.slice(0, 80), kind: "defpill", empty: false });
              }
              resolve(out.length ? out : null);
            })
            .catch(function () { resolve(null); });
        });
      });
    }

    function cpSummarizeLeaves(bodyEl, reserveOnly) {
      if (!bodyEl) return;
      var board = bodyEl.closest(".cp-console");
      if (!board) return;
      var folder = bodyEl.closest(".cp-console-section");
      var level = (folder && folder.getAttribute("data-cp-folder") || "").charAt(0);
      var targets = CP_LEAF_ALLOW_BY_LEVEL[level] || [];
      if (!targets.length) return;
      // Reserve the dock while its menu section is first laid out. Reading leaves
      // must wait until the complete reseller board has finished its folder POSTs.
      if (!reserveOnly && !cpPeekObserver && typeof IntersectionObserver === "function") {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            if (entry.target.__cpPeekLoad) entry.target.__cpPeekLoad();
          });
        }, { root:board, rootMargin:"160px" });
        cpPeekObserver = observer;
      }
      function start(box) {
        if (reserveOnly || box.dataset.cpPeekStarted === "1") return;
        box.dataset.cpPeekStarted = "1";
        if (cpPeekObserver) cpPeekObserver.observe(box);
        else box.__cpPeekLoad();
      }
      targets.forEach(function (target) {
        var anchor = bodyEl.querySelector('a[name="' + target + '"]');
        if (!anchor) return;
        // The native menu keeps title and description in consecutive TRs. Put
        // Peek under that option's description without rebuilding the menu card.
        var titleRow = anchor.closest("tr");
        var descRow = titleRow && titleRow.nextElementSibling;
        var card = descRow && !descRow.querySelector("a.navMenuItem") && descRow.querySelector("td");
        if (!card) return;
        var existing = card.querySelector(".cp-leaf-summary");
        if (existing) { start(existing); return; }
        var box = document.createElement("div");
        box.className = "cp-leaf-summary cp-leaf-dock";
        box.setAttribute("aria-busy", "true");
        var loading = document.createElement("div");
        loading.className = "cp-leaf-loading";
        loading.setAttribute("aria-label", "Loading preview");
        loading.setAttribute("role", "status");
        for (var sk = 0, reserved = CP_LEAF_RESERVED_ROWS[target] || 1; sk < reserved; sk++) {
          var skeleton = document.createElement("div");
          skeleton.className = "cp-leaf-skeleton-row";
          skeleton.setAttribute("aria-hidden", "true");
          for (var barIndex = 0; barIndex < 2; barIndex++) skeleton.appendChild(document.createElement("span"));
          loading.appendChild(skeleton);
        }
        box.appendChild(loading);
        card.appendChild(box);
        box.__cpPeekLoad = function () { cpFetchLeaf("/commpilot" + target).then(function (rows) {
          if (cpSectionAborted || !document.querySelector(".cp-console") || !box.isConnected) { return; }
          if (!rows || !rows.length) {
            if (box.animate && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
              var empty = box.animate([{ opacity:1 }, { opacity:0 }],
                { duration:180, easing:"ease-out" });
              empty.onfinish = empty.oncancel = function () { box.remove(); };
            } else box.remove();
            return;
          }
          var ready = document.createElement("div");
          ready.className = "cp-leaf-ready";
          rows.forEach(function (r) {
            var row = document.createElement("div"); row.className = "cp-leaf-row";
            var k = document.createElement("span"); k.className = "cp-leaf-key";
            k.textContent = rows.length === 1 && r.edit && !r.keepLabel ? "Current \u00b7" : r.label + " \u00b7";
            k.title = r.label;
            var v;
            if (r.pill) {
              // A source value still carries its own icon inside the shared dock.
              v = document.createElement("span");
              v.className = "cp-leaf-srcpill cp-leaf-src-" + r.pill;
              v.innerHTML = (r.pill === "sys" ? CP_SVG_SRC_SYS : CP_SVG_SRC_RES);
              var vt = document.createElement("span"); vt.textContent = r.value; v.appendChild(vt);
              v.title = r.value;
            } else if (r.kind === "defpill") {
              // Values can be copied; editable settings also get a pencil action.
              v = document.createElement("span");
              v.className = "cp-leaf-valwrap";
              var pill = document.createElement("span");
              pill.className = "cp-leaf-defpill" + (r.empty ? " cp-leaf-defpill-empty" : "");
              pill.textContent = r.value;
              pill.title = r.value;
              v.appendChild(pill);
              var acts = document.createElement("span");
              acts.className = "cp-leaf-act";
              (function (pillEl, actsEl, rr) {
                if (rr.copy !== false && (!rr.empty || rr.edit)) {
                  var cb = document.createElement("button");
                  cb.type = "button"; cb.className = "cp-leaf-actbtn"; cb.title = "Copy"; cb.setAttribute("aria-label", "Copy value");
                  cb.innerHTML = CP_SVG_LEAF_COPY;
                  cb.addEventListener("click", function (ev) {
                    ev.stopPropagation(); ev.preventDefault();
                    if (/^\s*None\s*$/.test(pillEl.textContent)) return;
                    var wr = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(pillEl.textContent) : Promise.reject();
                    wr.then(function () {
                      cb.innerHTML = CP_SVG_LEAF_CHECK;
                      setTimeout(function () { cb.innerHTML = CP_SVG_LEAF_COPY; }, 1200);
                    }).catch(function () {});
                  });
                  actsEl.appendChild(cb);
                }
                if (rr.edit) {
                  var eb = document.createElement("button");
                  eb.type = "button"; eb.className = "cp-leaf-actbtn"; eb.title = "Edit"; eb.setAttribute("aria-label", "Edit value");
                  eb.innerHTML = CP_SVG_LEAF_PENCIL;
                  eb.addEventListener("click", function (ev) {
                    ev.stopPropagation(); ev.preventDefault();
                    cpLeafEdit(pillEl, actsEl, rr);
                  });
                  actsEl.appendChild(eb);
                }
              })(pill, acts, r);
              if (acts.childNodes.length) v.appendChild(acts);
            } else {
              v = document.createElement("span"); v.className = "cp-leaf-val"; v.textContent = r.value; v.title = r.value;
            }
            row.appendChild(k); row.appendChild(v); ready.appendChild(row);
          });
          var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reduceMotion && box.animate) {
            ready.style.opacity = "0";
            ready.inert = true;
            ready.setAttribute("aria-hidden", "true");
            box.classList.add("cp-leaf-settling");
            box.appendChild(ready);
            var reveal = ready.animate([{ opacity:0 }, { opacity:1 }],
              { duration:240, easing:"ease-out", fill:"both" });
            var fade = loading.animate([{ opacity:1 }, { opacity:0 }],
              { duration:240, easing:"ease-out", fill:"both" });
            reveal.onfinish = reveal.oncancel = function () {
              reveal.onfinish = reveal.oncancel = null;
              loading.remove();
              reveal.cancel();
              fade.cancel();
              ready.style.opacity = "";
              ready.inert = false;
              ready.removeAttribute("aria-hidden");
              box.classList.remove("cp-leaf-settling");
              box.setAttribute("aria-busy", "false");
            };
          } else { box.replaceChildren(ready); box.setAttribute("aria-busy", "false"); }
          // Keep a nearby section jump aligned if a page supplies more rows than
          // its reserved placeholder count. Leave later manual scrolling alone.
          if (cpJumpAnchorSec && document.contains(cpJumpAnchorSec)) {
            var lfCons = document.querySelector(".cp-console");
            if (lfCons) {
              var off = cpJumpAnchorSec.getBoundingClientRect().top - lfCons.getBoundingClientRect().top;
              if (off >= 0 && off < 320) lfCons.scrollTop += off;
            }
          }
        }).catch(function () { try { box.remove(); } catch (e) {} }); };
        start(box);
      });
    }

    // Group and User Peeks have explicit small-page recipes. This keeps list,
    // credential, and dense forms out of the board and fixes each dock's row count.
    function cpReadCompactLeaf(cell, path) {
      var route = path.replace(/^\/commpilot/, "");
      var form = cell.querySelector('form[name="mainForm"]');
      if (/^\/(?:Group|User)\//.test(route)) {
        if (!form || form.querySelector('input[type="password"], input[type="file"]')) return null;
        var settingNames = {};
        [].slice.call(form.querySelectorAll("input, select, textarea")).forEach(function (el) {
          var type = (el.type || "").toLowerCase();
          if (el.name && type !== "hidden" && type !== "button" && type !== "submit" && type !== "image") settingNames[el.name] = true;
        });
        if (Object.keys(settingNames).length > 3) return null;
      }
      function named(name) {
        return form ? [].slice.call(form.querySelectorAll("[name]")).filter(function (el) { return el.name === name; }) : [];
      }
      function input(name, type) {
        return named(name).find(function (el) {
          return el.tagName === "INPUT" && (!type || el.type === type);
        }) || null;
      }
      function checked(name) {
        var field = input(name, "checkbox");
        return field ? !!(field.checked || field.hasAttribute("checked")) : null;
      }
      function radio(name) {
        var fields = named(name).filter(function (el) {
          return el.tagName === "INPUT" && el.type === "radio";
        });
        var selected = fields.find(function (el) { return el.checked || el.hasAttribute("checked"); });
        return selected ? selected.value : null;
      }
      function selectValue(name) {
        var field = named(name).find(function (el) { return el.tagName === "SELECT"; });
        if (!field) return null;
        var option = field.options[field.selectedIndex];
        return (option && option.textContent || field.value || "").trim();
      }
      function status(label, value) { return { label:label, value:value ? "On" : "Off" }; }
      function toggle(label, name, type, value) {
        return { label:label, value:value ? "On" : "Off", kind:"defpill", empty:false, copy:false, keepLabel:true,
          edit:{ path:path, name:name, type:type } };
      }
      function editableText(label, name) {
        var field = input(name, "text");
        if (!field || named(name).length !== 1) return null;
        var value = (field.value || "").trim();
        return { label:label, value:value || "None", kind:"defpill", empty:!value,
          edit:{ path:path, name:name, type:"text" } };
      }
      if (route === "/Group/EmergencyCallNotification/") {
        var on = checked("sendEmergencyCallNotificationEmail");
        var address = input("emergencyCallNotifyEmailAddress", "text");
        if (on === null || !address) return null;
        var email = (address.value || "").trim();
        return [status("Email alerts", on), {
          label:"Send to", value:email || "None", kind:"defpill", empty:!email,
          edit:{ path:path, name:"emergencyCallNotifyEmailAddress" }
        }];
      }
      if (route === "/Group/ExtensionMgmt/") {
        var min = selectValue("groupExtMinLength");
        var max = selectValue("groupExtMaxLength");
        var normal = selectValue("groupExtDefaultLength");
        if (min === null || max === null || normal === null) return null;
        return [{ label:"Minimum", value:min }, { label:"Maximum", value:max }, { label:"Default", value:normal }];
      }
      if (route === "/Group/DeviceActivationPolicy/") {
        var source = radio("useServiceProviderSettings");
        var requests = checked("allowActivationRequestByUser");
        var emailCode = checked("sendActivationCodeInEmail");
        if (source === null || requests === null || emailCode === null) return null;
        return [
          { label:"Settings source", value:source === "true" ? "Service Provider" : "Group" },
          status("User requests", requests), status("Email code", emailCode)
        ];
      }
      if (route === "/Group/Call_Center/ExternalReporting/") {
        var reporting = radio("reportingChoice");
        if (reporting === null) return null;
        return [{ label:"External reports", value:/^enhanced$/i.test(reporting) ? "Enhanced" : "Off" }];
      }
      if (route === "/User/ACR/" || route === "/User/VoicePortalCalling/") {
        var single = radio("active");
        if (single === null) return null;
        return [toggle("Enabled", "active", "radio", single === "true")];
      }
      if (route === "/User/DND/") {
        var dnd = radio("active"), splash = checked("ringSplash");
        if (dnd === null || splash === null) return null;
        return [toggle("Do not disturb", "active", "radio", dnd === "true"),
          toggle("Ring splash", "ringSplash", "checkbox", splash)];
      }
      if (route === "/User/CW/") {
        var waiting = radio("active"), hideId = checked("disableCLID");
        if (waiting === null || hideId === null) return null;
        return [toggle("Call waiting", "active", "radio", waiting === "true"),
          toggle("Hide caller ID", "disableCLID", "checkbox", hideId)];
      }
      if (route === "/User/RemoteOffice/") {
        var remote = radio("active"), remoteNumber = editableText("Remote number", "remoteOfficeNumber");
        if (remote === null || !remoteNumber) return null;
        return [toggle("Remote office", "active", "radio", remote === "true"), remoteNumber];
      }
      if (route === "/User/CF/Always/" || route === "/User/CF/Busy/" || route === "/User/CF/Not_Reachable/") {
        var forwarding = radio("active"), destination = editableText("Forward to", "forwardedToNumber");
        if (forwarding === null || !destination) return null;
        var forwardingRows = [toggle("Forwarding", "active", "radio", forwarding === "true"), destination];
        if (route === "/User/CF/Always/") {
          var forwardSplash = checked("ringSplash");
          if (forwardSplash === null) return null;
          forwardingRows.push(toggle("Ring splash", "ringSplash", "checkbox", forwardSplash));
        }
        return forwardingRows;
      }
      return undefined;
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
        // Device-management Modify pages (Tag Sets, Device Families, …): breadcrumb = [Reseller, <entity>, …Modify].
        // The generic SP/Group idx-logic below would POST the entity NAME (e.g. a tag-set name) as a Service-Provider
        // key → 500 → token degraded → LOGOUT. Here ANY ancestor crumb just goes back to that resource's Reseller
        // LIST (/Operator/System/<Seg>/Modify/ ⇒ /Reseller/<Seg>/). idx 0 still falls through to reseller home below.
        var dmm = location.pathname.match(/\/commpilot\/Operator\/System\/([A-Za-z0-9_]+)\/Modify\//);
        if (dmm && idx >= 1) { window.redirectPost("/commpilot/Reseller/" + dmm[1] + "/", {}); return; }
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
        // Quiet icons (Option A, 0.2.298): the CURRENT pill leads with its page icon (13px). Ancestors stay
        // text-only. Id pills and un-iconed titles (level homes, deep pages) render exactly as before —
        // no icon, no flex class. Icon before label; cpAttachCrumbDropdown appends the chevron after.
        var curSvg = (isCur && !(lastIsId || segIsId) && typeof cpHeaderIcon === "function") ? cpHeaderIcon(seg) : "";
        if (curSvg) {
          pill.classList.add("cp-bc-cur-hasico");
          var curIco = document.createElement("span");
          curIco.className = "cp-bc-cur-ico";
          curIco.setAttribute("aria-hidden", "true");
          curIco.innerHTML = curSvg;
          pill.appendChild(curIco);
          var curLbl = document.createElement("span");
          curLbl.textContent = seg;
          pill.appendChild(curLbl);
        } else {
          pill.textContent = seg;
        }
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
      var crumb = document.querySelector(".cp-breadcrumb.cp-bc-pill");
      if (!crumb) return;
      // Wire the ancestor pills the FULL-LOAD crumb (skin.js cpMoveBreadcrumb, ISOLATED world) built by MOVING
      // the legacy headerAuthLevelLink anchors. On some CommPilot builds (e.g. the apps-sbx sandbox) those
      // anchors carry NO inline onclick/href — the app JS-wires nav to their original header slot — so once
      // moved they are DEAD. pjax is MAIN world and CAN reach redirectPost, so wire the dead pills via
      // cpCrumbNav (same nav the pjax-swap crumb uses). Skip any pill that still has a native handler (builds
      // where the inline onclick survives the move) so we never double-navigate. Idempotent via __cpCrumbWired.
      var trail = [].map.call(crumb.querySelectorAll(".cp-bc-seg, .cp-bc-cur"), function (p) { return (p.textContent || "").trim(); });
      [].forEach.call(crumb.querySelectorAll(".cp-bc-seg"), function (seg, i) {
        if (seg.__cpCrumbWired || seg.getAttribute("href") || seg.onclick || seg.getAttribute("onclick")) return;
        seg.__cpCrumbWired = true;
        seg.setAttribute("role", "link");
        seg.setAttribute("tabindex", "0");
        seg.style.cursor = "pointer";
        (function (idx) {
          seg.addEventListener("click", function (e) { e.preventDefault(); cpCrumbNav(idx, trail); });
          seg.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cpCrumbNav(idx, trail); } });
        })(i);
      });
      // Mega-menu dropdown on the current pill (needs the level's harvested pages).
      var sig = cpSidebarSig(document.querySelector('form[name="leftNavForm"]'));
      var data = sig && cpLevelPages[sig];
      if (data) cpAttachCrumbDropdown(crumb.querySelector(".cp-bc-cur"), data);
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
          // Quiet icons (Option A, 0.2.298): each item carries its CP_HDR_ICONS glyph — muted at rest,
          // lavender on hover/active (CSS); un-iconed pages get the dashed tracker placeholder, same rule
          // as the console cards / sidebar sub-items. The two folder-titled "Profile" items (Call Center /
          // Meet-Me) disambiguate by GROUP label, mirroring wrapMenuCards' R3/R4 console-folder split.
          var iconTitle = pg.name;
          if (/^profile$/i.test(pg.name) && g.label) {
            if (/call center/i.test(g.label)) iconTitle = "call center profile";
            else if (/meet-?me/i.test(g.label)) iconTitle = "meet-me profile";
          }
          var iSvg = (typeof cpHeaderIcon === "function") ? cpHeaderIcon(iconTitle) : "";
          var ico = document.createElement("span");
          ico.setAttribute("aria-hidden", "true");
          ico.className = "cp-bc-dd-ico" + (iSvg ? "" : " cp-bc-dd-ico-todo");
          if (iSvg) ico.innerHTML = iSvg;
          item.appendChild(ico);
          var lbl = document.createElement("span");
          lbl.className = "cp-bc-dd-lbl";
          lbl.textContent = pg.name;
          item.appendChild(lbl);
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
      if (cpPeekObserver) { cpPeekObserver.disconnect(); cpPeekObserver = null; }
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
        a.setAttribute("data-cp-menuid", menuId);   // used by the folder-click takeover (below) to replay the nav safely
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
      // A fresh non-reseller page without its entity-entry POST has no safe
      // way to restore the server context after the folder reads.
      if (aggLevel && (!cpEntityEntry || !cpEntityEntry.url)) return;
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
      if (!aggLevel) { cpAggEnd(); cpBoardFailed = false; }
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
      consoleDiv.addEventListener("click", function (event) {
        if (!cpBoardFailed || !event.target.closest("a.navMenuItem")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cpShowBoardFailure();
      }, true);
      // CommPilot puts each option's title and description in separate table rows.
      // Forward clicks from either row to its real anchor so the complete visible
      // option is selectable while PJAX still sees the native link and its wiring.
      consoleDiv.addEventListener("click", function (event) {
        // A partially revealed Peek is still inert; a click on its loading
        // layer must not fall through to the option's navigation row.
        if (event.target.closest('.cp-leaf-summary[aria-busy="true"]')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (document.body.classList.contains("cp-help-active")) return;
        if (event.target.closest("a, button, input, select, textarea, label, [role='button']")) return;
        var row = event.target.closest("tr");
        if (!row || !row.closest(".cp-console-body")) return;
        var titleRow = row.querySelector("a.navMenuItem") ? row : row.previousElementSibling;
        if (!titleRow || (titleRow !== row && titleRow.nextElementSibling !== row)) return;
        var link = titleRow.querySelector("a.navMenuItem");
        if (!link || !link.closest(".cp-console-body")) return;
        event.preventDefault();
        link.click();
      }, true);
      // The native breadcrumb remains in the fixed header. This board contains
      // only the folder options, so the right pane can scroll independently.
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
        // The current native header already has the breadcrumb. Keep it in its
        // fixed row; the board owns only the scrolling workspace below it.
        contentCell.appendChild(consoleDiv);
        consoleDiv.querySelectorAll(".cp-console-section").forEach(function (s) { s.style.display = "none"; });
        document.documentElement.classList.add("cp-board-active");
        cpWireConsoleScroll();
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
      // The selected Line header follows the same content scroll as the sidebar.
      // Keep this independent of cpScrollSpy's temporary click suppression so its
      // accent can finish moving while a smooth folder jump is in flight.
      var sections = cons.querySelectorAll(".cp-console-section");
      var lineActive = 0;
      for (var si = 0; si < sections.length; si++) {
        if (sections[si].getBoundingClientRect().top - consTop < 130) lineActive = si;
      }
      sections.forEach(function (sec, si) {
        sec.classList.toggle("cp-line-active", si === lineActive);
        sec.classList.toggle("cp-line-past", si < lineActive);
      });
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
          if (/^[RGU]\d+$/.test(folder || "")) cpSummarizeLeaves(bodyEl, true);
          cpReexecWiringScripts(bodyEl);
          cpSetSectionCount(bodyEl);
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
          if (cpAggActive) {
            bodyEl.textContent = "Menu section unavailable.";
            if (done) done();
            return;
          }
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
        function settlePeekReads(ready) {
          var currentBoard = document.querySelector(".cp-console");
          if (!currentBoard || !secs.length || !document.contains(secs[0])) return;
          if (!ready || cpBoardFailed) {
            currentBoard.querySelectorAll(".cp-leaf-summary:not([data-cp-peek-started])").forEach(function (box) { box.remove(); });
            return;
          }
          if (!/^[RGU]\d+$/.test(secs[0].getAttribute("data-cp-folder") || "")) return;
          secs.forEach(function (s) { cpSummarizeLeaves(s.querySelector(".cp-console-body")); });
        }
        // Folder prefetches at SP/Group/User level mutate CommPilot's server-side
        // target context. Re-enter the selected entity once before exposing the
        // finished board; otherwise a linked list may open but its next Search
        // POST fails with HTTP 500 despite having the response's fresh token.
        if (cpAggActive) {
          var restoreFolder = cpAggAnchorFolder || secs[0].getAttribute("data-cp-folder");
          var restoreSection = document.querySelector('.cp-console-section[data-cp-folder="' + restoreFolder + '"]');
          var restoreMenuId = restoreSection && restoreSection.getAttribute("data-cp-menuid") || "2";
          var restoreToken = (document.getElementsByName("formtokenserial")[0] || {}).value || cpAggToken;
          var needsEntityEntry = cpEntityEntry && cpEntityEntry.url;
          var restoreUrl = needsEntityEntry ? cpEntityEntry.url : "/commpilot/Common/folder_contents.jsp";
          var restoreParams = needsEntityEntry ? cpEntityEntry.params || {} : { folder: restoreFolder, menuId: restoreMenuId };
          cpFollowFrame(restoreUrl, restoreParams, restoreToken, 0, 20000).then(function (res) {
            var restored = !!(res && res.doc && res.doc.querySelector('td[width="82%"] a.navMenuItem'));
            cpDbg("[pjax] board context restore", restored, !!(res && res.doc), !!(res && res.auth === false), res && res.doc && res.doc.title,
              res && res.doc && res.doc.querySelectorAll('td[width="82%"] a.navMenuItem').length);
            if (restored) {
              var nextToken = res.doc.getElementsByName("formtokenserial")[0];
              if (nextToken && nextToken.value) {
                var liveTokens = document.getElementsByName("formtokenserial");
                for (var ti = 0; ti < liveTokens.length; ti++) liveTokens[ti].value = nextToken.value;
              }
            }
            var ready = restored && !cpAggPrefetchFailed;
            cpAggEnd(ready);
            settlePeekReads(ready);
          }).catch(function () { cpAggEnd(false); settlePeekReads(false); });
        } else { cpAggEnd(true); settlePeekReads(true); }
        // Sequence complete — re-enable the scroll handler + restore the proper (tight) tail. Also
        // reveal any above-section still held invisible (one that never got confirmed off-screen, e.g.
        // a residual clamp) so nothing is left hidden.
        cpRevealBusy = false;
        var cdone = document.querySelector(".cp-console");
        if (cdone) cdone.querySelectorAll(".cp-console-section").forEach(function (s) { if (s.style.visibility) s.style.visibility = ""; });
        cpFitConsoleTail();
        if (cpPopScroll !== null && cdone) {
          cdone.scrollTop = cpPopScroll;
          cpPopScroll = null;
          cpScrollSpy();
        }
        cpHeadFade();
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

    function cpAttachNativeDirectoryExport() {
      if (!/\/Group\/CompanyDir\//.test(location.pathname)) return;
      var search = document.getElementById("searchTable");
      var field = document.getElementById("findKey0");
      if (!search || !field || document.getElementById("cp-native-directory-export")) return;
      var button = document.createElement("button");
      button.id = "cp-native-directory-export";
      button.type = "button";
      button.textContent = "Export directory";
      button.title = "Download the full group directory as two Excel workbooks in a ZIP file";
      button.addEventListener("click", function () {
        var opts = [].map.call(field.options, function (o) {
          return { value: o.value, label: (o.textContent || "").trim() };
        });
        cpExportUsers({
          fieldOpts: opts,
          entity: (document.title || "").replace(/:\s*Group Directory\s*$/i, "").trim()
        });
      });
      search.parentNode.insertBefore(button, search);
    }

    var cpBoardBuildQueued = false;
    function cpAutoConsole() {
      var cell = document.querySelector('td[width="82%"][valign="top"]');
      var isFolderMenu = !!(cell && cell.querySelector('a.navMenuItem') &&
        document.querySelector('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen'));
      if (!isFolderMenu) {
        if (cpPeekObserver) { cpPeekObserver.disconnect(); cpPeekObserver = null; }
        document.documentElement.classList.remove("cp-board-active");
        if (cpPopScroll !== null && cell) {
          var restoreTop = cpPopScroll;
          cpPopScroll = null;
          requestAnimationFrame(function () { cell.scrollTop = restoreTop; });
        }
      } else if (!cell.querySelector(".cp-console")) {
        // cpHook's fetched page schedules its own DOMContentLoaded wiring in
        // microtasks. Let those handlers finish against the native menu before
        // replacing it with the board; its copied links are then wired once.
        if (!cpBoardBuildQueued) {
          cpBoardBuildQueued = true;
          Promise.resolve().then(function () {
            cpBoardBuildQueued = false;
            if (cell.isConnected && cell.querySelector('a.navMenuItem') && !cell.querySelector('.cp-console')) cpBuildConsole();
          });
        }
      }
      setTimeout(cpAttachNativeDirectoryExport, 0);
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
      // NEVER fall through to the anchor's own legacy listener. The per-render wiring scripts attach
      // listeners by uuid id (link_/anchor_<uuid>); after a console rebuild a stale re-execution has been
      // seen MIS-ATTACHING a menu ITEM's redirectPost to a folder anchor (live 2026-07-02: clicking the
      // "Resources" folder fired Xsi Policy Profile's empty-context POST → server 500 → session KILLED →
      // logout). We know the folder + menuId (enumerated at build, stamped on the anchor) — replay the
      // folder nav ourselves in both non-scroll cases.
      function cpFolderNavTakeover() {
        e.preventDefault();
        e.stopImmediatePropagation();
        try { window.redirectPost("/commpilot/Common/folder_contents.jsp", { folder: fid, menuId: a.getAttribute("data-cp-menuid") || "8" }); } catch (err) {}
      }
      if (!document.querySelector('.cp-console')) {
        // Not on the console (e.g. a Groups/Users list): navigate to the folder menu, remembering which
        // folder was clicked so the console jumps to THAT section instead of defaulting to the top (Profile).
        cpPendingFolder = fid;
        cpFolderNavTakeover();
        return;
      }
      var sec = document.querySelector('.cp-console-section[data-cp-folder="' + fid + '"]');
      if (!sec) { cpFolderNavTakeover(); return; }
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
