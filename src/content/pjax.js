(function () {
  // The hidden POST transport loads CommPilot in sandboxed frames. PJAX owns
  // only the top-level page; running here would rewrite the frame's joint
  // history state and can turn Back into a full document navigation.
  if (window !== window.top) return;
  // Bulk tools retain their native context while an overlay is open. Read-only
  // exports share keyboard handling but may opt out of holding browser history.
  window.cpFocusBulkDialog = function (overlay, options) {
    options = options || {};
    var previous = document.activeElement;
    var ownUrl = location.href, ownState = history.state;
    function rememberPage() { ownUrl = location.href; ownState = history.state; }
    function holdBack(event) {
      if (!overlay.isConnected) return;
      event.stopImmediatePropagation();
      // The preview belongs to the group that opened it. Browser history must
      // not post a different entity behind the still-open batch dialog.
      history.pushState(ownState, '', ownUrl);
    }
    var box = overlay.querySelector('[role="dialog"]') || overlay;
    box.tabIndex = -1;
    function focusable() {
      return [].slice.call(box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')).filter(function (el) {
        return el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length;
      });
    }
    function focusInside() { (focusable()[0] || box).focus(); }
    function keepFocus(event) {
      if (overlay.isConnected && !overlay.contains(event.target)) focusInside();
    }
    function keys(event) {
      if (!overlay.isConnected) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (options.onEscape) { options.onEscape(); return; }
        var close = overlay.querySelector('[data-action="close"]');
        if (close && !close.disabled) close.click();
      } else if (event.key === 'Tab') {
        var controls = focusable(), index = controls.indexOf(document.activeElement);
        event.preventDefault(); event.stopImmediatePropagation();
        if (!controls.length) box.focus();
        else controls[index < 0 ? (event.shiftKey ? controls.length - 1 : 0) :
          (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
      }
    }
    document.addEventListener('focusin', keepFocus, true);
    document.addEventListener('keydown', keys, true);
    if (options.history !== false) {
      document.addEventListener('cp:reskin', rememberPage);
      window.addEventListener('popstate', holdBack, true);
    }
    focusInside();
    return function () {
      document.removeEventListener('focusin', keepFocus, true);
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('cp:reskin', rememberPage);
      window.removeEventListener('popstate', holdBack, true);
      if (previous && previous.isConnected) previous.focus();
    };
  };
  // Version stamp — logged on EVERY page load (login included) so a reload is trivially verifiable
  // in the console (read for "[pjax] v…"). Bump per build alongside manifest.json so a stale/failed
  // reload is caught immediately instead of chasing a phantom bug. Keep in sync with manifest version.
  var CP_PJAX_VERSION = "0.3.86-native";

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
        e.timer = setTimeout(function () { if (e.count > 1) console.warn(msg + " (x" + e.count + ")"); delete cpCoMap[key]; }, 1600);
        return;
      }
      if (e && e.timer) clearTimeout(e.timer);
      console.warn(msg);
      cpCoMap[key] = { count: 1, last: now, timer: setTimeout(function () { delete cpCoMap[key]; }, 1600) };
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

  // One-shot marker from stubguard.js: the nav a browser-button reload just replayed natively (see cpReloadEntry).
  var cpReloadNav = null;
  try {
    cpReloadNav = JSON.parse(sessionStorage.getItem("cp-reload-nav") || "null");
    sessionStorage.removeItem("cp-reload-nav");
    if (!cpReloadNav || !cpReloadNav.url || /^https?:\/\//i.test(cpReloadNav.url) ||
        !(Date.now() - (cpReloadNav.at || 0) < 60000)) cpReloadNav = null;
  } catch (e) { cpReloadNav = null; }

  var cpDeviceProfileOrigin = history.state && history.state.cpDeviceOrigin || null;
  var cpContextNavActive = null;
  function cpDeviceProfileBase(path) {
    return /^\/commpilot\/(?:Group|ServiceProvider|Operator\/System)\/DeviceInventory\/Modify\//.exec(String(path || ''))?.[0] || '';
  }
  function cpDeviceProfilePage(path, params) {
    if (cpDeviceProfileBase(path)) return path;
    if (/^\/commpilot\/Common\/(?:find|findAll|page|sort)\.jsp$/.test(path)) {
      var owner = String(params && params.returnPage || cpSearchLanding || '');
      if (owner.indexOf('/commpilot/') !== 0) owner = '/commpilot' + owner;
      if (cpDeviceProfileBase(owner)) return owner;
    }
    return '';
  }
  var initialDevicePage = cpDeviceProfilePage(location.pathname,history.state?.cpNav?.params || cpReloadNav?.params);
  if (!initialDevicePage) cpDeviceProfileOrigin = null;
  else {
    // A native POST reload (including the recovery interstitial) can replace history.state. Keep only this
    // tab's read-only return navigation, and verify it still belongs to the profile the server rendered.
    try {
      cpDeviceProfileOrigin ||= JSON.parse(sessionStorage.getItem('cp-device-origin') || 'null');
      var initialDeviceForm = document.forms.mainForm;
      var initialDevice = initialDeviceForm && (initialDeviceForm.elements.namedItem('deviceName') || initialDeviceForm.elements.namedItem('key'));
      if (cpDeviceProfileOrigin && (cpDeviceProfileOrigin.base !== cpDeviceProfileBase(initialDevicePage) ||
          initialDevice && initialDevice.value && cpDeviceProfileOrigin.identity && initialDevice.value !== cpDeviceProfileOrigin.identity.key)) {
        cpDeviceProfileOrigin = null;
        sessionStorage.removeItem('cp-device-origin');
      }
    } catch (e) { cpDeviceProfileOrigin = null; }
  }
  try {
    var cpInitialPath = location.pathname;
    // A fresh reseller login lands on folder_contents.jsp by POST. Replaying
    // that URL without its folder selection bounces to Login on Back. A reload
    // replay records the nav it replayed, so Back returns to the same entity.
    // Like an in-session level change, a replayed entry that landed on a folder menu (a Modify entry or a
    // breadcrumb up-nav) is its own Back target; only an ordinary page keeps the entry it was opened under.
    var cpReloadOwnEntry = !!cpReloadNav &&
      !!document.querySelector('td[width="82%"] a.navMenuItem') &&
      !!document.querySelector('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen') &&
      (cpReloadNav.url.indexOf("/Common/folder_contents.jsp") === -1 ||
        (!!cpReloadNav.params && !cpReloadNav.params.folder && !!(cpReloadNav.params.menuId || cpReloadNav.params.P_menuId)));
    var cpInitialNav = cpReloadNav && cpInitialPath.indexOf("/Login/") === -1 ?
      { url: cpReloadNav.url, params: cpReloadNav.params || {},
        entry: !cpReloadOwnEntry && cpReloadNav.entry && cpReloadNav.entry.url ? cpReloadNav.entry : null } :
      cpInitialPath === "/commpilot/Common/folder_contents.jsp" ?
      { url: cpInitialPath, params: { folder: "R0", menuId: "8" } } :
      cpInitialPath.indexOf("/commpilot/") === 0 && cpInitialPath.indexOf("/Login/") === -1 ?
      { url: cpInitialPath + location.search, params: {} } :
      { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
    history.replaceState({ cpNav: cpInitialNav, cpDeviceOrigin: cpDeviceProfileOrigin }, "", location.href);
  } catch (e) {}

  var onLogin =
    location.pathname.indexOf("/Login/") !== -1 ||
    // A password field ALONE is not a login page — the admin Modify page has Reset-Password fields but is a real
    // in-app page (it carries the app content cell / nav). Only treat a password field as "login" when the app
    // chrome is ABSENT (a true login page has no content cell or nav menu). Otherwise the Modify page falsely set
    // onLogin → cp-pending-return → a spurious full-load + auto-return on its own form navigations.
    (!!document.querySelector('input[name="password"]') &&
     !document.querySelector('td[width="82%"], a.navMenuItem, .navOptions'));
  // After a sign-in the extension reopens the last page (auto-return, below). A return that ends back on the Login
  // page failed: CommPilot could not open that page in the new session and signed it out ("Error loading the menu
  // … [Error 6004] … serviceProviderId xsi:nil"). Forget the page then, so the next sign-in starts at home instead
  // of failing the same way every time (seen 2026-10-07: a timed-out user could not sign back in in that tab).
  try {
    if (onLogin) {
      var _returnAt = parseInt(sessionStorage.getItem("cp-return-at") || "0", 10) || 0;
      var _loginMsg = (document.querySelector("td.loginerror") || {}).textContent || "";
      sessionStorage.removeItem("cp-return-at");
      if ((_returnAt && Date.now() - _returnAt < 90000) || /Error loading the menu/i.test(_loginMsg)) {
        sessionStorage.removeItem("cp-last-nav");
        sessionStorage.removeItem("cp-pending-return");
      } else if (sessionStorage.getItem("cp-last-nav")) sessionStorage.setItem("cp-pending-return", "1");
    }
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
  var cpLastNav = cpInitialNav || { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
  var cpPopReplaying = false;
  var cpPopScroll = null;
  // The page on screen, updated when a swap commits rather than when its request is sent (see cpPaintedCommit):
  // its history entry, put back when a Back/Forward replay fails after the browser has moved the address; its
  // navigation, which F5 refreshes; and its recovery navigation, put back when a later request fails.
  var cpPaintedEntry = { state: history.state, href: location.href };
  var cpCommittedNav = cpLastNav;
  var cpCommittedRecover = null;
  var cpReexecutingScripts = false;
  var cpAutoReplaceUrl = null;
  var cpConfigFilesForwarded = false;
  var _orig = null;
  var cpHook = null;
  var cpSrcCollector = null;
  var cpExternalDclRestore = null;
  var cpBulkScriptsReady = Promise.resolve(null);
  var cpNativeScriptsLoading = false;
  var cpNativeScriptRequests = new Set();
  // Scripts already parsed by the initial native document need no second install.
  // Later native forms can introduce head libraries absent from that landing page.
  var cpNativeHeadSources = new Set([].slice.call(document.querySelectorAll('head script[src]')).map(function (s) { return s.src; }));
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
  // The last level change made by a real entity entry (a Modify-style POST, not folder_contents). CommPilot's
  // native breadcrumb goes UP a level with a bare folder_contents {menuId} POST that only works from inside a
  // descendant's context; recovery re-enters this entry first, then replays that up-nav.
  var cpDeepEntry = null;
  function cpIsLevelUpNav(url, params) {
    return String(url || "").indexOf("/Common/folder_contents.jsp") !== -1 && !!params && !params.folder &&
      !!(params.menuId || params.P_menuId);
  }
  // A browser-button reload is replayed natively by stubguard.js, so this page load starts without the
  // entity entry that set the server context. stubguard leaves the replayed nav as a one-shot marker: a
  // Modify-style nav that landed on a folder menu IS the entry; a folder_contents nav carries its entry.
  // cpBuildConsole may use it only for this load's first board (cpAutoConsole clears it otherwise).
  var cpReloadEntry = null;
  try {
    // A replay that fell back to Login proves nothing about the next session's context (its login morphs in place).
    if (cpReloadNav && !onLogin) {
      // A bare breadcrumb up-nav is the level's own entry once the replay re-established the descendant it
      // climbs from (the board restores with it in-session too); a folder read restores with its recorded entry.
      var cpReloadSource = cpIsLevelUpNav(cpReloadNav.url, cpReloadNav.params) ? cpReloadNav :
        cpReloadNav.url.indexOf("/Common/folder_contents.jsp") !== -1 ? cpReloadNav.entry : cpReloadNav;
      if (cpReloadSource && cpReloadSource.url && !/^https?:\/\//i.test(cpReloadSource.url) &&
          (cpReloadSource.url.indexOf("folder_contents.jsp") === -1 || cpIsLevelUpNav(cpReloadSource.url, cpReloadSource.params)))
        cpReloadEntry = { url: cpReloadSource.url, params: cpReloadSource.params || {} };
      // The replay re-entered this descendant, so a later breadcrumb up-nav can climb from it again.
      if (cpReloadNav.entry && cpReloadNav.entry.url && cpReloadNav.entry.url.indexOf("folder_contents.jsp") === -1 &&
          !/^https?:\/\//i.test(cpReloadNav.entry.url))
        cpDeepEntry = { url: cpReloadNav.entry.url, params: cpReloadNav.entry.params || {} };
    }
  } catch (e) {}
  // One-shot follow-up nav consumed after the NEXT successful swap — lets a caller chain "enter the entity,
  // THEN open the page" through pjax (auto-return after login uses it; see cpEntityEntry). It belongs to the
  // request that posts its entry (`after`); see cpNavClaim.
  var cpPendingNav = null;
  // The lease of a save (OK/Apply/Delete/Save/Submit) still waiting for CommPilot; see cpWriteNav.
  var cpWritePending = null;
  // The sequence of the last navigation or upload actually sent to CommPilot; see cpWriteHandBack.
  var cpSentSeq = 0;
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
  // A rejected follow can replay page scripts that immediately try the same navigation again.
  // Once token recovery has failed, make a single sign-in transition instead of posting in a loop.
  var cpSessionRedirecting = false;
  // CommPilot confirmed a deliberate sign-out, and this tab is leaving for Login with its return page and Recent
  // locations forgotten (cpSignOutFetch). A request settling or sent meanwhile must not store them again.
  var cpSignedOut = false;
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
  var cpBulkOwner = null, cpBulkPermit = false;
  var cpTokenDrainSeq = 0;
  // The in-shell navigation currently in progress (its whole fetch → swap chain), or null. A lazy Peek read
  // must not start while it runs: the navigation already sent the live single-use token, so a second POST
  // with it leaves the page holding a consumed token and the next request (e.g. Back) signs the user out.
  var cpNavPending = null;
  // RESELLER anchor reuse: the open folder cpHook just fetched to land here IS the console's anchor
  // section, so re-fetching it (the old behaviour) fired a SECOND back-to-back folder_contents on the
  // rotating single-use token → the anchor (Profile) intermittently shelled = "Couldn't load — Retry".
  // Capture that already-fetched menu once and let cpFetchSection reuse it (mirrors cpAggCache at SP).
  var cpEntryFolder = null;   // the captured anchor folder id (e.g. "R0")
  var cpEntryHtml = null;     // its menu HTML; consumed once by cpFetchSection, then nulled

  // Match the browser's script classification, including legacy MIME aliases.
  // https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
  function cpNativeScriptKind(script) {
    var raw = script.getAttribute('type');
    if (raw === null) {
      var language = script.getAttribute('language');
      raw = language ? 'text/' + language : 'text/javascript';
    } else if (raw === '') raw = 'text/javascript';
    raw = raw.toLowerCase();
    var asciiTrim = function (text) { return text.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''); };
    var mime = script.hasAttribute('type') ? asciiTrim(raw) : raw;
    if (/^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(mime)) {
      if (script.noModule) return null;
      if (script.hasAttribute('for') && script.hasAttribute('event') &&
          (asciiTrim(script.getAttribute('for')).toLowerCase() !== 'window' ||
           !/^onload(?:\(\))?$/.test(asciiTrim(script.getAttribute('event')).toLowerCase()))) return null;
      return 'classic';
    }
    return /^(?:module|importmap|speculationrules)$/.test(raw) ? raw : null;
  }

  function cpNativeInlineScript(script) {
    var kind = cpNativeScriptKind(script);
    return (kind === 'classic' || kind === 'module') && !script.hasAttribute('src');
  }

  // Re-execute scripts inside a container by replacing each <script>
  // with a fresh copy that carries the live nonce.
  function reexecScripts(container) {
    var olds = Array.prototype.slice.call(container.querySelectorAll("script"));
    for (var j = 0; j < olds.length; j++) {
      var old = olds[j];
      var kind = cpNativeScriptKind(old);
      if (!kind) continue; // Preserve data blocks and scripts the browser ignores.
      var s = document.createElement("script");
      var attrs = old.attributes;
      for (var k = 0; k < attrs.length; k++) {
        if (attrs[k].name !== "nonce") s.setAttribute(attrs[k].name, attrs[k].value);
      }
      if (LIVE_NONCE) s.nonce = LIVE_NONCE;
      if (old.src && (kind === 'classic' || kind === 'module')) {
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

  // Native save-and-forward links and bulk saves call the validator explicitly. Replaying only body scripts
  // leaves its head dependencies (e.g. trim) undefined after list -> Add navigation.
  // Use native script elements/CSP nonce, preserving parser order across head and
  // body. Do not synthesize helpers or continue with a partially loaded validator.
  function cpIsNativeDocumentGuard(script) {
    // This exact native head bootstrap already ran on the full document load.
    // Its style node is intentionally absent afterward. Replaying it for an
    // inner-page swap throws on null.parentNode before the form can initialize.
    // Match the complete known script, never arbitrary code mentioning the ID.
    var source = (script.textContent || '').replace(/[\s;]/g, '').replace(/'/g, '"');
    return source === 'if(self===top){varantiCrossFraming=document.getElementById("antiCrossFraming")' +
      'antiCrossFraming.parentNode.removeChild(antiCrossFraming)}else{top.location=self.location}';
  }

  async function cpNativePageScripts(doc, url, containers, refreshPageHead, isCurrent, includeHead) {
    var head = includeHead === false ? [] : [].slice.call(doc.head.querySelectorAll('script'));
    var body = containers.flatMap(function (c) { return [].slice.call(c.querySelectorAll('script')); });
    for (var old of head.concat(body)) {
      if (isCurrent && !isCurrent()) return;
      if (cpNativeScriptKind(old) !== 'classic') continue;
      var inHead = head.indexOf(old) !== -1;
      var inContent = !inHead && containers[0].contains(old);
      var dclStart = window.__cpDclFns.length;
      var src = old.getAttribute('src');
      if (inHead && !src && self === top && !document.getElementById('antiCrossFraming') && cpIsNativeDocumentGuard(old)) continue;
      var sourceLabel = src ? new URL(src, new URL(url, location.href)).pathname :
        (inHead ? 'head script ' + (head.indexOf(old) + 1) : 'page script ' + (body.indexOf(old) + 1));
      if (src) {
        var scriptUrl = new URL(src, new URL(url, location.href));
        // Some native Voice Management responses spell the application root
        // /CommPilot/. The deployed root is /commpilot/ (the former returns 403).
        // Preserve the case of the script's own path and the same-origin check.
        scriptUrl.pathname = scriptUrl.pathname.replace(/^\/commpilot\//i, '/commpilot/');
        src = scriptUrl.href;
        if (new URL(src).origin !== location.origin)
          throw new Error('A native script could not load from the CommPilot origin.');
        // Shared libraries survive a PJAX swap, but a page's validate.js may
        // have been replaced by another page's globals since the last visit.
        if (inHead && cpNativeHeadSources.has(src) &&
            (!refreshPageHead || /^\/commpilot\/Scripts\//i.test(new URL(src).pathname))) continue;
      }
      var script = document.createElement('script');
      for (var attr of old.attributes) {
        if (attr.name !== 'nonce' && attr.name !== 'src' && attr.name !== 'async' && attr.name !== 'defer')
          script.setAttribute(attr.name, attr.value);
      }
      if (LIVE_NONCE) script.nonce = LIVE_NONCE;
      script.setAttribute('data-cp-native-source', sourceLabel);
      script.async = false;
      if (src) script.src = src;
      else script.textContent = old.textContent;
      await new Promise(function (resolve, reject) {
        var timer, runtimeError = null, finished = false;
        var onError = function (event) {
          if (event.target === script || document.currentScript === script || (src && event.filename === src))
            runtimeError = new Error('Native script failed (' + sourceLabel + '): ' +
              ((event.error && event.error.message) || event.message || 'JavaScript initialization failed.'));
        };
        var finish = function (error, timedOut) {
          // Removing a requested script does not cancel its eventual execution.
          // Retain its completion handlers after timeout so navigation can tell
          // whether a late response can still overwrite another page's globals.
          if (!timedOut) {
            cpNativeScriptRequests.delete(script);
            script.onload = script.onerror = null;
          }
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          window.removeEventListener('error', onError, true);
          if (error || runtimeError) {
            if (script.parentNode) script.parentNode.removeChild(script);
            reject(error || runtimeError);
          }
          else { if (src && inHead) cpNativeHeadSources.add(src); resolve(); }
        };
        window.addEventListener('error', onError, true);
        if (src) {
          cpNativeScriptRequests.add(script);
          script.onload = function () { finish(); };
          script.onerror = function () { finish(new Error('Native script could not load (' + sourceLabel + ').')); };
          timer = setTimeout(function () { finish(new Error('Native script timed out while loading (' + sourceLabel + ').'), true); }, 15000);
        }
        try {
          if (inHead) document.head.appendChild(script);
          else old.replaceWith(script);
          if (!src) finish();
        } catch (error) { finish(new Error('Native script failed (' + sourceLabel + '): ' + error.message)); }
      });
      // Definitions survive on window after execution. Remove the temporary
      // head node for external validators too: revisiting native forms must
      // reload their globals without retaining another script in each snapshot.
      // cpNativeHeadSources still records shared libraries installed once.
      if (inHead) script.remove();
      // Only content handlers should be replayed by the list row-fill helper.
      if (!inContent) window.__cpDclFns.splice(dclStart);
    }
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
    cpLastNav = cpCommittedNav = { url: nav.url, params: nav.params || {} };
    try {
      history.replaceState({ cpNav: { url: nav.url, params: nav.params || {} } }, "", nav.url);
      cpPaintedEntry = { state: history.state, href: location.href };
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
      var redirect = null;
      for (var i = 0; i < ss.length && !redirect; i++) {
        // Data blocks and fallback text in external scripts do not execute.
        if (!cpNativeInlineScript(ss[i])) continue;
        redirect = cpParseNativeScriptRedirect(ss[i].textContent || "");
      }
      if (!redirect) return null;
      var tEl = doc.getElementsByName("formtokenserial")[0];
      return { target: redirect.url, data: redirect.params, token: tEl ? tEl.value : null };
    }

    function cpParseNativeScriptRedirect(src) {
      // Read literal native redirect calls, never example text or comments.
      // This scanner does not evaluate the server's JavaScript.
      var re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\bredirectPost\s*\(/g, match;
      while ((match = re.exec(src))) {
        if (!/^redirectPost\b/.test(match[0])) continue;
        var range = {}, redirect = cpParseNativeRedirect(src.slice(match.index), range);
        if (redirect && range.start === 0) return redirect;
      }
      return null;
    }

    function cpParseNativeRedirect(src, parsedRange) {
      // Native identifiers can contain either quote and escaped Unicode. Keep
      // quoted braces inside their string rather than ending the payload early.
      var m = /redirectPost\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*(?:,\s*(\{(?:[^{}'"\\]|\\.|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")*\}))?\s*\)/.exec(src);
      if (!m) return null;
      var data = {};
      var re = /(\w+)\s*:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g, mm;
      while ((mm = re.exec(m[3] || ''))) data[mm[1]] = cpUnescapeJs(mm[2] === undefined ? mm[3] : mm[2]);
      if (parsedRange) { parsedRange.start = m.index; parsedRange.end = m.index + m[0].length; }
      return { url: cpUnescapeJs(m[1] === undefined ? m[2] : m[1]), params: data };
    }

    function cpBulkRequestDiagnostic(url) {
      var diagnostic = cpBulkOwner && cpBulkOwner.diagnostic;
      if (!diagnostic) return null;
      var record = {path:new URL(url, location.href).pathname, method:'POST', status:null, responseType:null};
      diagnostic.requests.push(record);
      return record;
    }
    function cpIsSignInDocument(doc) {
      if (!doc || doc.querySelector('td[width="82%"]')) return false;
      return /^(?:CommPilot\s*[-:]?\s*)?(?:Login|Log in|Sign in)$/i.test((doc.title || '').trim()) ||
        /Please login again|not authorized to access the system/i.test(doc.body && doc.body.textContent || '') ||
        !!doc.querySelector('form[action*="Login"] input[type="password"], form[action*="login"] input[type="password"]');
    }

    function cpHttpFailure(status, doc) {
      // A rejected request can still rotate the session token. Retain it, but
      // never expose an error document as usable menu/form content to callers.
      // A sign-in form's token belongs to authentication, not this app session.
      if (doc && !cpIsSignInDocument(doc)) {
        var token = doc.getElementsByName('formtokenserial')[0];
        if (token) cpWriteToken(token.value);
      }
      return { err: status };
    }

    function cpPersonalAssistantVerified(doc, name, shouldExist) {
      var cell = doc && doc.querySelector('td[width="82%"]');
      if (!cell || !cell.querySelector('[name="add"]') || cpSearchTooMany(doc)) return false;
      if ([].slice.call(cell.querySelectorAll('.error, .errorMsg, .Failure')).some(function (el) {
        return (el.textContent || '').trim();
      })) return false;
      var rows = cpSearchParseRows(doc);
      var found = rows.some(function (row) { return row.cells[0] === String(name).trim(); });
      if (shouldExist) return found;
      // Absence on one page, or in an unfinished list, does not prove deletion.
      var page = cpSearchPageOf(doc);
      return !found && (!page || (page.cur === 1 && page.total === 1)) &&
        (rows.length > 0 || cpSearchHasEmptyMarker(doc));
    }

    function cpNavigationAddressError(url) {
      try {
        if (typeof url !== 'string' || !url) throw new Error('Missing address');
        var target = new URL(url, location.href);
        if (target.origin !== location.origin || target.username || target.password)
          return 'The CommPilot navigation address is outside this site or contains credentials. No request was sent.';
      } catch (e) {
        return 'The CommPilot navigation address is invalid. No request was sent.';
      }
      return null;
    }

    function cpFollow(u, p, token, depth) {
      var addressError = cpNavigationAddressError(u);
      if (addressError) return Promise.resolve({ navigationError: addressError });
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
      // Match the conservative iframe deadline. A stalled response/body must not
      // hold the token-drain lock forever; expiry is not proof a save was rejected.
      var requestController = new AbortController(), requestExpired = false;
      var requestDeadline = setTimeout(function () { requestExpired = true; requestController.abort(); }, 90000);
      var _settled = false, _done = function () { if (_settled) return; _settled = true; clearTimeout(requestDeadline); cpInflightPosts = Math.max(0, cpInflightPosts - 1); };
      // redirect:"manual" — a server 3xx is this app's LOGIN/SESSION BOUNCE (the server hard-codes an
      // http:// Login redirect). Under the default redirect:"follow" the browser tries to follow that hop,
      // block-all-mixed-content (page CSP) blocks the http:// target, and fetch REJECTS with
      // "TypeError: Failed to fetch" — INDISTINGUISHABLE from a dropped socket — while ALSO logging a
      // connect-src CSP violation (the console noise). With redirect:"manual" the bounce comes back as a clean
      // opaqueredirect Response (status 0, type "opaqueredirect"): no attempted http hop → no CSP violation, no
      // false network error. We route it as {auth:false} so cpHook's fresh-token re-attempt / recovery runs
      // instead of a silent dead click. Normal navs are 200 with content — this POST-based app never uses a 3xx
      // for real navigation. See [[gotcha-idle-connection-drop-dead-click]] / [[gotcha-csp-inline-style-attr-blocked]].
      var requestDiagnostic = cpBulkRequestDiagnostic(u);
      return fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "same-origin",
        redirect: "manual",
        signal: requestController.signal
      })
        .then(function (r) {
          if (requestDiagnostic) { requestDiagnostic.status = r.status; requestDiagnostic.responseType = r.type; }
          if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
            cpWarnCo("bounce|" + u, "[pjax] session bounce (server redirect) on " + u + " (hop " + depth + ") — auth-fail, no socket drop");
            return { auth: false };
          }
          if (r.status === 401) return { auth: false, sessionRejected: true };
          if (r.status >= 400) {
            // Server error — return a DISTINCT failure and DO NOT parse/follow the error page's embedded
            // redirect stub. The old flow hopped the stub back into the failing endpoint (up to depth 4 →
            // 5 token-bearing POSTs into a 500ing page), which is how one broken menu item (DeviceInventory
            // Find-All, Xsi at reseller) escalated a single 500 into a KILLED SESSION → logout (live
            // 2026-07-02). Callers route {err} to an in-place notice / grid error state — no more requests.
            cpWarnCo("resp|" + u + "|" + r.status, "[pjax] response " + r.status + " " + u + " (hop " + depth + ") — aborting (no stub-follow on a server error)");
            return Promise.resolve().then(function () { return r.text(); }).then(function (html) {
              return cpHttpFailure(r.status, new DOMParser().parseFromString(cpStripInlineStyles(html), 'text/html'));
            }).catch(function () {
              // The HTTP failure is already known. An unreadable body must
              // not turn it into a network error that could replay this POST.
              return { err: r.status };
            });
          }
          cpDbg("[pjax] response", r.status, r.url, "(hop " + depth + ")");
          return r.text().then(function (html) {
            clearTimeout(requestDeadline); // Any redirect hop has its own request deadline.
            html = cpStripInlineStyles(html);
            var doc = new DOMParser().parseFromString(html, "text/html");
            if (cpIsSignInDocument(doc)) return { auth: false };
            var responseToken = doc.getElementsByName('formtokenserial')[0];
            var readbackToken = responseToken ? responseToken.value : token;
            // Personal Assistant's Add saves the criterion but answers with a
            // tiny script calling top.location.replace('../'). It has no
            // content cell or redirectPost stub. Read the owner list and
            // confirm the new row instead of replaying the save or opening Login.
            if ((!html || /top\.location\.replace\(\s*["']\.\.\/["']\s*\)/.test(html)) &&
                /^\/commpilot\/User\/PersonalAssistant\/Add\/index\.jsp$/.test(new URL(u, location.href).pathname) &&
                p && p.criteriaName && p.ok != null) {
              cpWriteToken(readbackToken);
              return cpFollow('/commpilot/User/PersonalAssistant/', {}, readbackToken, depth + 1).then(function (listResult) {
                if (cpPersonalAssistantVerified(listResult && listResult.doc, p.criteriaName, true))
                  return listResult;
                return { doc: listResult && listResult.doc || doc,
                  unverifiedSave: 'CommPilot redirected after saving, but the new Personal Assistant rule could not be verified. Check the list before trying again.' };
              });
            }
            // Delete succeeds, then this controller tries to render the now
            // missing criterion and paints an "Invalid selective criteria name"
            // error. Confirm absence on the parent list before swapping it.
            if (/^\/commpilot\/User\/PersonalAssistant\/Modify\/index\.jsp$/.test(new URL(u, location.href).pathname) &&
                p && p.delete != null && (p.criteriaName || p.key || p.P_key)) {
              var deletedCriterion = String(p.criteriaName || p.key || p.P_key);
              cpWriteToken(readbackToken);
              return cpFollow('/commpilot/User/PersonalAssistant/', {}, readbackToken, depth + 1).then(function (listResult) {
                if (cpPersonalAssistantVerified(listResult && listResult.doc, deletedCriterion, false))
                  return listResult;
                return { doc: listResult && listResult.doc || doc,
                  unverifiedSave: 'CommPilot returned an error after Delete, and the Personal Assistant rule could not be verified as removed. Check the list before trying again.' };
              });
            }
            // A page reached through a redirect stub also reports that hop's parameters: the server's own
            // navigation to it, which cpHook can keep for a save that landed there (never the submitted form).
            if (doc.querySelector('td[width="82%"]'))
              return { doc: doc, html: html, responseUrl: new URL(u, location.href).href, responseParams: depth > 0 ? p || {} : null };
            var stub = cpExtractStub(doc);
            if (stub && stub.target) {
              if (depth >= 4)
                return { doc: doc, navigationError: 'CommPilot returned too many redirects. Your current page is still open; the request was not repeated.' };
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
              try {
                var resolvedStub = new URL(st, new URL(u, location.href));
                if (resolvedStub.origin !== location.origin || resolvedStub.username || resolvedStub.password)
                  return { doc: doc, navigationError: 'CommPilot returned a redirect outside this site or containing credentials. Your current page is still open.' };
                st = resolvedStub.pathname + resolvedStub.search;
              } catch (e) {
                return { doc: doc, navigationError: 'CommPilot returned an invalid navigation address. Your current page is still open.' };
              }
              cpDbg("[pjax] following stub ->", st);
              return cpFollow(st, stub.data, stub.token, depth + 1);
            }
            return { doc: doc, html: html, responseUrl: new URL(u, location.href).href };
          });
        })
        .then(function (v) { _done(); return v; }, function (e) {
          if (requestExpired) {
            e = new Error('CommPilot did not respond within 90 seconds.');
            e.name = 'TimeoutError';
            if (requestDiagnostic) requestDiagnostic.failure = 'Request timed out';
          } else if (requestDiagnostic && requestDiagnostic.status === null) requestDiagnostic.failure = 'Network request failed';
          _done(); throw e;
        });
    }

    // Harvest a FRESH valid app token in-place (the one GET-allowed, session-aware endpoint) — mirrors
    // stubguard's cpHarvestOnce trust rule EXACTLY: trust the token ONLY when servlet/Login hands back an
    // app redirect (redirectPost -> folder_contents), never the login form's own token. Transport/server
    // failures reject separately from an unauthenticated response; they do not establish session expiry.
    // redirect:"manual" so a dead-session http:// Login bounce resolves as opaqueredirect (null) with NO
    // connect-src violation. Used by cpHook to recover a still-alive-but-token-stale nav in place instead of
    // hard-logging-out. See [[gotcha-idle-connection-drop-dead-click]].
    function cpHarvestFreshToken() {
      var controller = new AbortController();
      var deadline = setTimeout(function () { controller.abort(); }, 8000);
      // Although this is a GET, its response rotates the same session token as a POST. Other navigation
      // must drain it, and retain its fresh token even if a newer click supersedes the original page.
      cpInflightPosts++;
      return fetch("/commpilot/servlet/Login", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual", signal: controller.signal })
        .then(function (r) {
          if (r.status >= 400 && r.status !== 401) throw new Error('Session check failed (HTTP ' + r.status + ').');
          if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) return null;
          return r.text();
        })
        .then(function (html) {
          if (html === null) return null;
          var doc = new DOMParser().parseFromString(cpStripInlineStyles(html), "text/html");
          var stub = cpExtractStub(doc);
          var token = (stub && stub.target && stub.target.indexOf("folder_contents") !== -1 && stub.token) ? stub.token : null;
          if (!token && !cpIsSignInDocument(doc)) throw new Error('The session check returned an incomplete page.');
          if (token && !controller.signal.aborted) cpWriteToken(token);
          return token;
        })
        .catch(function () {
          throw new Error('CommPilot could not finish checking the session. Your current page is still open; try again in a moment.');
        })
        .finally(function () { clearTimeout(deadline); cpInflightPosts = Math.max(0, cpInflightPosts - 1); });
    }

    // Iframe transport. At Service-Provider / Group / User levels, folder_contents.jsp returns a
    // content-less SHELL to an out-of-band fetch (XHR) but real CONTENT to a navigation. A hidden
    // sandboxed iframe IS a navigation, so it retrieves the real menu with no top-level nav/flash.
    // sandbox="allow-same-origin" (NO allow-scripts) keeps the doc readable AND neutralises the
    // page's frame-buster (which otherwise drives top.location back out). Mirrors cpFollow's
    // {doc,html}|{auth:false} contract incl. redirect-stub following (the SP "Modify" entry →
    // folder_contents 2-step), so cpHook's swap logic is identical regardless of transport.
    var CP_FRAME_WAIT_MS = 90000;
    function cpFollowFrame(url, params, token, depth, timeoutMs) {
      var addressError = cpNavigationAddressError(url);
      if (addressError) return Promise.resolve({ navigationError: addressError });
      return new Promise(function (resolve) {
        var ifr, pendingForm, deadline;
        function newFrame() {
          ifr = document.createElement("iframe");
          ifr.name = "cpFrame" + (++cpFrameSeq);
          ifr.setAttribute("sandbox", "allow-same-origin");
          // The extension's own all-frames scripts stay out (they check frameElement): this document is only read,
          // and their work would slow the load and be copied into the swapped page.
          ifr.setAttribute("data-cp-transport", "");
          ifr.style.cssText = "position:absolute;width:10px;height:10px;border:0;left:-9999px;top:-9999px";
          document.body.appendChild(ifr);
        }
        newFrame();
        cpInflightPosts++;   // a token-bearing navigation POST in flight (drained by the reload handler)
        var settled = false;
        function removeForm(form) {
          if (!form) return;
          // Native field names can shadow form.parentNode and form.remove.
          var parent = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode').get.call(form);
          if (parent) Node.prototype.removeChild.call(parent, form);
        }
        function done(val) {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          cpInflightPosts = Math.max(0, cpInflightPosts - 1);
          // Prototype replaces Element.remove with a helper that throws for a
          // detached node. Cleanup must never strand the navigation promise.
          removeForm(pendingForm);
          pendingForm = null;
          ifr.onload = null;
          try { ifr.remove(); } catch (e) {}
          resolve(val);
        }
        function postSafely(u, p, tok, d, freshFrame) {
          try {
            if (freshFrame) { try { ifr.remove(); } catch (e) {} newFrame(); }
            post(u, p, tok, d);
          } catch (e) {
            done({ navigationError: 'CommPilot could not finish this navigation. The request was not repeated. Your current page is still open.' });
          }
        }
        function post(u, p, tok, d) {
          var f = pendingForm = document.createElement("form");
          f.method = "POST"; f.action = u; f.target = ifr.name;
          function add(n, v) { var inp = document.createElement("input"); inp.type = "hidden"; inp.name = n; inp.value = v; Node.prototype.appendChild.call(f, inp); }
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
            var html = "", responseUrl, responseStatus = 0;
            try {
              responseUrl = ifr.contentWindow.location.href;
              if ((responseUrl || "") === "about:blank") return;  // initial load, ignore
              html = ifr.contentDocument.documentElement.outerHTML;
            } catch (e) {
              // Browser network-error pages and cross-origin responses are unreadable here.
              // That alone does not establish session expiry or authorize replaying this POST.
              done({ navigationError: 'CommPilot could not load this page. The response was interrupted or could not be read. Your current page is still open.' });
              return;
            }
            // Supporting browsers expose the frame's HTTP status without an
            // extra request. Missing timing support retains the document checks.
            try {
              var navigationTiming = ifr.contentWindow.performance.getEntriesByType('navigation')[0];
              if (navigationTiming && typeof navigationTiming.responseStatus === 'number') responseStatus = navigationTiming.responseStatus;
            } catch (e) {}
            removeForm(f);
            if (pendingForm === f) pendingForm = null;
            html = cpStripInlineStyles(html);
            var fdoc = new DOMParser().parseFromString(html, "text/html");
            if (responseStatus === 401) { done({ auth: false, sessionRejected: true }); return; }
            if (responseStatus >= 400 && responseStatus <= 599) { done(cpHttpFailure(responseStatus, fdoc)); return; }
            if (fdoc.querySelector('td[width="82%"]')) { done({ doc: fdoc, html: html }); return; }
            if (cpIsSignInDocument(fdoc)) { done({ auth: false }); return; }
            var stub = cpExtractStub(fdoc);
            if (stub && stub.target) {
              if (d >= 4) {
                done({ doc: fdoc, navigationError: 'CommPilot returned too many redirects. Your current page is still open; the request was not repeated.' });
                return;
              }
              var target;
              try {
                var frameTarget = new URL(stub.target, responseUrl);
                if (frameTarget.origin !== location.origin || frameTarget.username || frameTarget.password) {
                  done({ doc: fdoc, navigationError: 'CommPilot returned a redirect outside this site or containing credentials. Your current page is still open.' });
                  return;
                }
                target = frameTarget.href;
              }
              catch (e) {
                done({ doc: fdoc, navigationError: 'CommPilot returned an invalid navigation address. Your current page is still open.' });
                return;
              }
              cpDbg("[pjax] frame stub ->", target);
              // Each POST is the first navigation of a fresh frame. Reusing a
              // frame for the redirect chain adds joint session-history entries.
              // Those entries can intercept Back and discard the Forward page.
              postSafely(target, stub.data, stub.token, d + 1, true);
              return;
            }
            done({ doc: fdoc, html: html });
          };
          cpNativeFormSubmit.call(f);
        }
        // Wait as long as the browser would for the page. Giving up early (this was 8 s) left CommPilot still
        // working on the request: the reply's new single-use token never arrived, the next request went out with
        // the old one, and CommPilot signed the session out ("Error loading the menu … no target object"). A big
        // customer's pages take that long on the main site.
        deadline = setTimeout(function () { done({ auth: false, timedOut: true }); }, timeoutMs || CP_FRAME_WAIT_MS);
        postSafely(url, params || {}, token, depth || 0, false);
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
      if (cpBulkOwner) return Promise.resolve(false);
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
          return cpFollowFrame("/commpilot/Common/folder_contents.jsp", { folder: f.folder, menuId: f.menuId || "2" }, tok, 0, CP_FRAME_WAIT_MS)
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
      // PJAX replaces the content cell while the initial page's head remains.
      // Current list wiring takes precedence; native head-only pages still work.
      var cell = doc.querySelector('td[width="82%"]'), scopes = cell ? [cell, doc] : [doc];
      for (var scope = 0; scope < scopes.length; scope++) {
        var ss = scopes[scope].querySelectorAll("script"), src = "";
        for (var i = 0; i < ss.length; i++) {
          if (cpNativeInlineScript(ss[i])) src += (ss[i].textContent || "") + "\n";
        }
        var m = /returnPage:\s*['"]([^'"]+)['"]\s*,\s*tableName:\s*['"]([^'"]+)['"]/.exec(src);
        if (m) return { returnPage: m[1], tableName: m[2] };
      }
      return null;
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
      // Prototype 1.6 replaces Array#map/filter/some with Enumerable methods
      // requiring this.each. Convert DOM collections to arrays before use.
      return [].slice.call(doc.querySelectorAll("a.listSortHeader")).map(function (a) {
        return (a.textContent || "").replace(/\s+/g, " ").trim();
      });
    }
    // Generic row parse: each tr[id^=Row]; cells = the a.tableLink texts (Col0..ColN); drill = the row's
    // own redirectPost(url,{params}) (whole row is clickable). In a DOMParser'd fetched doc the
    // DOMContentLoaded wiring doesn't run, so the drill is read from the inline <script> text (decoding the
    // Unicode escapes in the composite key, including SCA's <!> separators).
    function cpSearchParseRows(doc) {
      var rows = [];
      doc.querySelectorAll('tr[id^="Row"]').forEach(function (tr) {
        var cells = [].slice.call(tr.querySelectorAll("a.tableLink")).map(function (a) {
          var t = (a.textContent || "").trim();
          return (!t && a.querySelector("img")) ? "✓" : t;   // boolean columns (e.g. In Trunk Group) render a checkmark IMAGE with no text → keep it as a ✓ marker
        });
        // Link-less list rows (e.g. Call Recording Platforms): cells are plain <td> TEXT with spacer <td>s
        // between columns and NO a.tableLink — read the row's non-empty <td> texts in order instead, so the
        // list is harvested instead of skipped (the "0 results" bug). Drill (if any) still comes from the
        // row's redirectPost below; System-level read-only rows simply have none.
        if (!cells.length) {
          cells = [].slice.call(tr.children).map(function (td) {
            if (td.tagName !== "TD") return "";
            var t = (td.textContent || "").replace(/\s+/g, " ").trim();
            // Boolean columns (e.g. DeviceType "Is Obsolete") render a checkmark IMAGE with no text —
            // same ✓ marker as the a.tableLink path above, or the flag silently drops from the grid.
            if (!t && td.querySelector("img")) t = "✓";
            return t;
          }).filter(function (t) { return t; });
        }
        if (!cells.length) return;
        rows.push({ cells: cells, drill: cpRowDrill(tr) });
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
    // Every caller (bulk tools, exports) spends the single-use token itself. The search's first POST starts
    // synchronously, so a navigation sent right after it waits for its token; with a list fill or a sweep running
    // (see cpListFill and cpSweep below) it stops first and lets its request land, and a reserved in-flight count
    // keeps any navigation behind this search meanwhile.
    function cpListSearch(criteria, opts) {
      if (!cpListFill && !cpSweep) return cpListSearchRun(criteria, opts);
      cpInflightPosts++;
      var held = true, release = function () { if (held) { held = false; cpInflightPosts = Math.max(0, cpInflightPosts - 1); } };
      // A list fill or a sweep yields to it (a bulk tool's search); the request either has in flight lands first.
      return Promise.all([cpListFillStop(), cpSweepStop()]).then(function () {
        try { return cpListSearchRun(criteria, opts); } finally { release(); }
      }, function (e) { release(); throw e; });
    }
    function cpListSearchRun(criteria, opts) {
      opts = opts || {};
      if (opts.signal && opts.signal.aborted) return Promise.reject(new Error('[search] Search was cancelled.'));
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
        return new Promise(function (resolve, reject) {
          var tries = 0;
          (function harvest() {
            if (opts.signal && opts.signal.aborted) { reject(new Error('[search] Search was cancelled.')); return; }
            if ([].slice.call(document.querySelectorAll('td.error, span.Failure')).some(function (el) { return (el.textContent || '').trim(); })) {
              reject(new Error('[search] CommPilot could not read the result list.')); return;
            }
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
              reject(new Error('[search] The result list did not finish loading.')); return;
            }
            var rows = aFilter(all);
            if (opts.onPage) { try { opts.onPage(rows.slice(), 0, 1); } catch (e) {} }
            if (opts.signal && opts.signal.aborted) { reject(new Error('[search] Search was cancelled.')); return; }
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
        if (opts.signal && opts.signal.aborted) throw new Error('[search] Search was cancelled.');
        var readError = [].slice.call(res.doc.querySelectorAll('td.error, span.Failure')).some(function (el) {
          return (el.textContent || '').trim();
        });
        if (readError || (!all.length && !cpSearchHasEmptyMarker(res.doc)))
          throw new Error('[search] CommPilot did not return a complete result list.');
        if (po && (po.cur !== 1 || !Number.isSafeInteger(totalPages) || totalPages < 1))
          throw new Error('[search] CommPilot returned an invalid first result page.');
        if (totalPages > 500 || (totalPages > 1 && (!desc || !all.length)))
          throw new Error('[search] The complete search could not be read. Narrow the search and try again.');
        if (opts.onPage) { try { opts.onPage(all.slice(), 0, totalPages); } catch (e) {} }

        var seq = Promise.resolve();
        for (var p = 1; p < totalPages; p++) (function (p) {
          seq = seq.then(function () {
            if (opts.signal && opts.signal.aborted) throw new Error('[search] Search was cancelled.');
            return cpFollow(location.origin + "/commpilot/Common/page.jsp",
              { returnPage: desc.returnPage, tableName: desc.tableName, value: String(p) }, tok, 0)
              .then(function (r2) {
                if (!r2 || r2.auth === false || !r2.doc) throw new Error('[search] The complete search could not be read. A result page is unavailable.');
                var pr = cpSearchParseRows(r2.doc);
                var nt2 = r2.doc.getElementsByName("formtokenserial")[0]; if (nt2 && nt2.value) { tok = nt2.value; cpWriteToken(tok); }
                if (opts.signal && opts.signal.aborted) throw new Error('[search] Search was cancelled.');
                var nextPage = cpSearchPageOf(r2.doc), nextDesc = cpSearchDescriptor(r2.doc);
                if (!pr.length || !nextPage || nextPage.cur !== p + 1 || nextPage.total !== totalPages ||
                    (nextDesc && (nextDesc.returnPage !== desc.returnPage || nextDesc.tableName !== desc.tableName)) ||
                    [].slice.call(r2.doc.querySelectorAll('td.error, span.Failure')).some(function (el) { return (el.textContent || '').trim(); }))
                  throw new Error('[search] CommPilot changed or omitted a result page. Search again before using these results.');
                if (opts.onDoc) { try { opts.onDoc(r2.doc); } catch (e) {} }
                all = all.concat(pr);
                if (opts.onPage) { try { opts.onPage(pr, p, totalPages); } catch (e) {} }
              });
          });
        })(p);
        return seq.then(function () {
          if (opts.signal && opts.signal.aborted) throw new Error('[search] Search was cancelled.');
          return { headers: headers, rows: all, totalPages: totalPages, desc: desc };
        });
      });
    }
    // Expose for the grid builder + live diagnostics.
    window.cpListSearch = cpListSearch;

    // --- List fill: every row of a native result list, for a page size that fits the window --------------
    // CommPilot pages a list 20 rows at a time. lists.js shows as many rows as fit the window, so it needs the
    // whole list: fetch pages 2..M of the list just shown (the same sequential page.jsp walk as cpListSearch,
    // threading the single-use token) and append their rows to the live table, each wired to its own row's
    // redirectPost target. A last request for page 1 puts CommPilot's own list state back where the page
    // shows it (sort and Back then behave as before). The fill always yields: it sends a request only while no
    // other token-bearing POST is in flight, and navigation, Reload and cpListSearch stop it and wait for its
    // request. Any failure (a page with no rows - Admins-style lists render theirs client-side - or a session
    // bounce) removes the added rows and leaves CommPilot's own pager.
    var cpListFill = null;
    var CP_LIST_FILL_MAX_PAGES = 50;
    function cpListFillStop() {
      var s = cpListFill, x = cpListExportRun;   // a list export walking its pages stops at the same moments
      if (x) x.abort = true;
      if (s) s.abort = true;
      return Promise.all([(s && s.busy) || null, (x && x.busy) || null]).then(function () {}, function () {});
    }
    // The row's click target, from the redirectPost its own script wires (one per row).
    function cpRowDrill(tr) {
      return cpParseNativeRedirect(tr.innerHTML);
    }
    function cpListFillStart() {
      if (cpBulkOwner) return;
      if (window !== window.top || cpGridState) return;
      var cell = document.querySelector('td[width="82%"]');
      if (!cell || cell.querySelector(":scope > .cp-console")) return;
      var tables = cell.querySelectorAll('table:has(> tbody > tr[id^="Row"])');
      if (tables.length !== 1) return;
      var table = tables[0];
      // A reskin is also used to decorate the current page. It is not a new search. In particular, don't stop
      // an in-flight collection or append the same pages again to a completed result set.
      if (table.hasAttribute('data-cp-fill')) return;
      var po = /Page\s+(\d+)\s+of\s+(\d+)/i.exec(cell.textContent || "");
      var search = cell.querySelector('#search0') && cell.querySelector('[name^="findValue"]');
      if (!po || +po[1] !== 1 || !Number.isSafeInteger(+po[2]) || +po[2] < 2 || +po[2] > 500 ||
          (!search && +po[2] > CP_LIST_FILL_MAX_PAGES)) return;
      var desc = cpSearchDescriptor(document);
      if (!desc) return;
      cpListFillStop();
      var total = +po[2], added = [];
      var state = { abort: false, busy: null };
      cpListFill = state;
      table.setAttribute("data-cp-fill", "loading");
      table.setAttribute("data-cp-results-ready", "false");
      table.setAttribute("data-cp-pages", String(total));
      table.setAttribute('data-cp-return-page',desc.returnPage);
      table.setAttribute('data-cp-table-name',desc.tableName);
      document.dispatchEvent(new CustomEvent("cp:list-fill"));
      var count = table.querySelectorAll(':scope > tbody > tr[id^="Row"]').length;
      var announce = function (status) {
        if (cpListFill === state) cpListFill = null;
        // A page that already replaced the list has lists of its own: a late stop must not send them back to loading.
        if (!table.isConnected) return;
        if (status === 'done') {
          var complete=document.createDocumentFragment();
          added.forEach(function(tr){complete.appendChild(tr);});
          table.tBodies[0].appendChild(complete);
        } else added.forEach(function (tr) { tr.remove(); });
        table.setAttribute("data-cp-fill", status);
        document.dispatchEvent(new CustomEvent("cp:list-fill"));
      };
      var hop = function (value) {
        if (state.abort || !table.isConnected) return Promise.reject(new Error("stopped"));
        if (cpInflightPosts > 0) return Promise.reject(new Error("busy"));
        var tokEl = document.getElementsByName("formtokenserial")[0];
        state.busy = cpFollow(location.origin + "/commpilot/Common/page.jsp",
          { returnPage: desc.returnPage, tableName: desc.tableName, value: String(value) }, tokEl ? tokEl.value : null, 0)
          .then(function (res) {
            state.busy = null;
            if (!res || res.auth === false || res.err || !res.doc) throw new Error("page " + value + " failed");
            var nt = res.doc.getElementsByName("formtokenserial")[0];
            if (nt && nt.value) cpWriteToken(nt.value);
            var returnedPage = cpSearchPageOf(res.doc), returnedDesc = cpSearchDescriptor(res.doc);
            if (!returnedPage || returnedPage.cur !== value + 1 || returnedPage.total !== total || !returnedDesc ||
                returnedDesc.returnPage !== desc.returnPage || returnedDesc.tableName !== desc.tableName ||
                [].slice.call(res.doc.querySelectorAll('td.error, span.Failure')).some(function (el) { return (el.textContent || '').trim(); }))
              throw new Error("page " + value + " did not match the requested results");
            return res.doc;
          }, function (e) { state.busy = null; throw e; });
        return state.busy;
      };
      var append = function (doc, pageNo) {
        var rows = doc.querySelectorAll('tr[id^="Row"]');
        if (!rows.length) throw new Error("page " + pageNo + " has no rows");
        rows.forEach(function (src) {
          var drill = cpRowDrill(src);
          var tr = document.importNode(src, true);
          tr.querySelectorAll("script").forEach(function (sc) { sc.remove(); });
          var oldId = tr.id;
          tr.id = "Row" + (++count);
          tr.querySelectorAll("[id]").forEach(function (el) {
            if (el.id.indexOf(oldId + "Col") === 0) el.id = tr.id + el.id.slice(oldId.length);
          });
          tr.setAttribute("data-cp-page", String(pageNo));
          tr.classList.add("cp-row-off");   // arrives off the page lists.js shows: nothing moves while loading
          if (drill) {
            tr.setAttribute("data-cp-drill", "1");
            tr.querySelectorAll("a").forEach(function (a) {
              a.addEventListener("click", function () { window.redirectPost(drill.url, drill.params); });
            });
          }
          // Keep later pages detached until the complete search is ready to commit.
          added.push(tr);
        });
      };
      // Let the page's own start-up requests finish before the first request.
      var start = Date.now();
      var seq = new Promise(function (resolve, reject) {
        (function idle() {
          if (state.abort) { reject(new Error("stopped")); return; }
          if (cpInflightPosts === 0) { resolve(); return; }
          if (Date.now() - start > 3000) { reject(new Error("busy")); return; }
          setTimeout(idle, 50);
        })();
      }).then(function () { return new Promise(function (resolve) { setTimeout(resolve, 200); }); });
      for (var p = 1; p < total; p++) (function (p) {
        seq = seq.then(function () { return hop(p); }).then(function (doc) { append(doc, p + 1); });
      })(p);
      seq.then(function () { return hop(0); })
        .then(function () { table.setAttribute("data-cp-rows", String(count)); announce("done"); },
          function (e) { cpDbg("[pjax] list fill stopped:", e && e.message); announce(state.abort ? "stopped" : "failed"); });
    }
    window.cpListFillStart = cpListFillStart;

    // Legacy pager wiring can survive a skin pass. Once the result set is complete, even a native doPage()
    // must ask lists.js to page the cached rows rather than POSTing page.jsp and replacing the workspace.
    function cpLocalListPage(url,params) {
      if (!/\/commpilot\/Common\/page\.jsp(?:\?|$)/.test(url || '') || !params ||
          !/^\d+$/.test(String(params.value))) return false;
      var tables=document.querySelectorAll('td[width="82%"] table[data-cp-fill="done"][data-cp-results-ready="true"]');
      for(var i=0;i<tables.length;i++){
        var table=tables[i];
        if(table.getAttribute('data-cp-return-page')!==String(params.returnPage) ||
            table.getAttribute('data-cp-table-name')!==String(params.tableName))continue;
        var event=new CustomEvent('cp:list-page',{cancelable:true,detail:JSON.stringify({
          returnPage:String(params.returnPage),tableName:String(params.tableName),offset:Number(params.value)*20
        })});
        return !document.dispatchEvent(event);
      }
      return false;
    }

    // --- List export: every result of a search, all its pages, as an Excel workbook ------------------------
    // lists.js asks with cp:list-export (JSON: the columns it shows, their names, and the rows when the whole list
    // is here) and hears back with cp:list-export-status (working · done · failed). When CommPilot's own pager
    // stayed (more pages than the fill brings in), every page is walked here with page.jsp, the same sequential,
    // token-threaded walk as the fill, and CommPilot's list is put back on the page shown. Navigation stops it
    // (cpListFillStop) and waits for its request.
    var cpListExportRun = null;
    function cpListExportStatus(state, extra) {
      var detail = { state: state };
      for (var k in (extra || {})) detail[k] = extra[k];
      document.dispatchEvent(new CustomEvent("cp:list-export-status", { detail: JSON.stringify(detail) }));
    }
    // A fetched cell as lists.js reads one on screen: its text without the wiring scripts; a ticked box or a check
    // image is "Yes".
    function cpListExportText(td) {
      if (!td) return "";
      var copy = td.cloneNode(true);
      copy.querySelectorAll("script, style").forEach(function (el) { el.remove(); });
      var text = (copy.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text;
      var box = td.querySelector('input[type="checkbox"]');
      if (box) return box.checked || box.hasAttribute("checked") ? "Yes" : "No";
      return td.querySelector("img") ? "Yes" : "";
    }
    function cpListExportSave(headers, rows, title) {
      var raw = (title || "List").replace(/\s+/g, " ").trim();
      var pad = function (n) { return (n < 10 ? "0" : "") + n; }, d = new Date();
      var stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      var name = raw.replace(/\s*:\s*/g, " - ").replace(/[\\/*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "List";
      var bytes = cpXlsxBuild([{ name: cpXlsxSheetName(raw.split(/:\s*/).pop() || "List", {}), headers: headers, rows: rows,
        widths: cpUxpWidths(headers, rows) }]);
      cpUxpDownloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name + " " + stamp + ".xlsx");
    }
    function cpListExport(req) {
      // A navigation on its way replaces this list: an export started now would walk it behind the next page.
      var navigating = function () { return !!cpNavPending || document.documentElement.getAttribute("data-cp-nav") === "busy"; };
      if (navigating()) { cpListExportStatus("failed", { message: "Wait for the page to finish opening" }); return; }
      var title = document.title;   // the workbook is named after the list asked for, not the page open when it is saved
      var done = function (rows) {
        try { cpListExportSave(req.headers, rows, title); cpListExportStatus("done", { count: rows.length }); }
        catch (e) { console.warn("[pjax] list export", e); cpListExportStatus("failed", { message: "Could not build the workbook" }); }
      };
      if (req.complete) { done(req.rows || []); return; }
      var desc = cpSearchDescriptor(document);
      if (!desc || !(req.pages > 0)) { cpListExportStatus("failed", { message: "This list cannot be read page by page" }); return; }
      // The walk belongs to the list on screen: like the list fill, it ends once another page has been swapped in.
      var swapAt = cpLastSwapAt, table = document.querySelector('td[width="82%"] table:has(> tbody > tr[id^="Row"])');
      var run = { abort: false, busy: null }, rows = [];
      var left = function () { return run.abort || cpLastSwapAt !== swapAt || (!!table && !table.isConnected); };
      var hop = function (value) {
        if (left()) return Promise.reject(new Error("stopped"));
        var tokEl = document.getElementsByName("formtokenserial")[0];
        run.busy = cpFollow(location.origin + "/commpilot/Common/page.jsp",
          { returnPage: desc.returnPage, tableName: desc.tableName, value: String(value) }, tokEl ? tokEl.value : null, 0)
          .then(function (res) {
            run.busy = null;
            if (!res || res.auth === false || res.err || !res.doc) throw new Error("page " + (value + 1) + " failed");
            var nt = res.doc.getElementsByName("formtokenserial")[0];
            if (nt && nt.value) cpWriteToken(nt.value);
            if (left()) throw new Error("stopped");
            // A successful transport is not proof that CommPilot returned this
            // result page. Refuse partial/mismatched exports just as list fill does.
            var returnedPage = cpSearchPageOf(res.doc), returnedDesc = cpSearchDescriptor(res.doc);
            if (!returnedPage || returnedPage.cur !== value + 1 || returnedPage.total !== Number(req.pages) ||
                !returnedDesc || returnedDesc.returnPage !== desc.returnPage || returnedDesc.tableName !== desc.tableName ||
                !res.doc.querySelector('tr[id^="Row"]') ||
                [].slice.call(res.doc.querySelectorAll('td.error, span.Failure')).some(function (el) { return (el.textContent || '').trim(); }))
              throw new Error("page " + (value + 1) + " did not match the requested results");
            return res.doc;
          }, function (e) { run.busy = null; throw e; });
        return run.busy;
      };
      cpListFillStop().then(function () {
        cpListExportRun = run;
        return new Promise(function (resolve, reject) {   // only once no other token-bearing request is out
          var t0 = Date.now();
          (function idle() {
            if (navigating()) run.abort = true;   // a navigation sent meanwhile replaces the list; others are waited out
            if (left()) { reject(new Error("stopped")); return; }
            if (cpInflightPosts === 0) { resolve(); return; }
            if (Date.now() - t0 > 5000) { reject(new Error("busy")); return; }
            setTimeout(idle, 50);
          })();
        });
      }).then(function () {
        var seq = Promise.resolve();
        for (var p = 0; p < req.pages; p++) (function (p) {
          seq = seq.then(function () { return hop(p); }).then(function (doc) {
            doc.querySelectorAll('tr[id^="Row"]').forEach(function (tr) {
              rows.push(req.columns.map(function (i) { return cpListExportText(tr.children[i]); }));
            });
            cpListExportStatus("working", { done: p + 1, total: req.pages });
          });
        })(p);
        return seq;
      }).then(function () { return hop(Math.max(0, (req.page || 1) - 1)); })   // CommPilot's list back on the page shown
        .then(function () {
          if (cpListExportRun === run) cpListExportRun = null;
          done(rows);
        }, function (e) {
          if (cpListExportRun === run) cpListExportRun = null;
          cpDbg("[pjax] list export stopped:", e && e.message);
          cpListExportStatus("failed", { message: left() ? "Stopped: the page changed" : "CommPilot did not return every page" });
        });
    }
    if (window === window.top) {
      document.addEventListener("cp:list-export", function (e) {
        var req = null;
        try { req = JSON.parse(e.detail); } catch (x) {}
        if (req && Array.isArray(req.columns) && Array.isArray(req.headers)) cpListExport(req);
      });
    }
    if (window === window.top) {
      document.addEventListener("cp:reskin", cpListFillStart);
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cpListFillStart, { once: true });
      else cpListFillStart();
    }

    // --- Sweep: every row of a search CommPilot refuses as too many (the alpha's "Load all", on the native list) ---
    // CommPilot answers a search that matches more than about a thousand records with "[Error 4027] Please narrow
    // your search, there are N matching records" and no rows. The page then offers to load them all: the search is
    // repeated with one more "starts with" criterion on a name field, one prefix at a time (a, b, … and, under a
    // prefix that is still too many, aa, ab, … plus the prefix itself as an exact value), each answer's pages walked
    // like the list fill, and every row kept once. A search that is a single "starts with" (Last Name starts with
    // M) lengthens its own prefix instead (Ma, Mb, …). Requests go one at a time, threading the single-use token:
    // the sweep sends only while no other token-bearing POST is in flight, and navigation, Reload, an upload or
    // another list search stop it (a request in flight still lands and refreshes the token). A failed search is
    // tried once more; two failing in a row end the sweep. Rows a name sweep cannot reach (no name) can be looked
    // for by the list's ID field afterwards. At the end the rows become one native result table (CommPilot's own
    // header and rows, each wired to its own redirectPost), so lists.js pages and sorts them like any list, and a
    // last search with the page's own criteria puts CommPilot's list state back. The view while it works is the
    // alpha's: a bar and a count, an alphabet tracker of the prefixes done, the prefix being searched, and Cancel.
    var cpSweep = null;
    var CP_SWP_DIGITS = "0123456789".split("");
    var CP_SWP_BASE = "0123456789abcdefghijklmnopqrstuvwxyz".split("");
    // Punctuation a name or an ID can start with; not % or _ (wildcards to the server: a prefix of them never
    // narrows) and not quotes, braces or backslashes.
    var CP_SWP_SPECIALS = " '-.,&()@#$!^*+=<>?/:;~".split("");
    var CP_SWP_TOP = CP_SWP_BASE.concat(CP_SWP_SPECIALS.slice(1));   // a value does not start with a space
    var CP_SWP_ALL = CP_SWP_BASE.concat(CP_SWP_SPECIALS);
    var CP_SWP_DEPTH = 6;
    var CP_SWP_PREFER = ["UserFirstName", "UserLastName", "UserID", "GroupName", "GroupId"];
    var CP_SWP_SVG = {
      funnel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5h17l-6.5 7.8V19l-4 1.5v-7.7Z"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
      x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 7 7 17M7 7l10 10"/></svg>'
    };
    function cpSweepEsc(v) {
      return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function cpSweepChar(c) { return c === " " ? "␣" : c; }
    function cpSweepNum(n) { return n == null ? "?" : Number(n).toLocaleString(); }
    function cpSweepMinutes(secs) {
      if (secs < 45) return "under a minute";
      var m = Math.round(secs / 60);
      return m <= 1 ? "about a minute" : "about " + m + " minutes";
    }
    // Stopped by something else wanting the token (navigation, Reload, an upload, another list search): the page
    // is going or busy, so the sweep leaves no trace. Cancel (the card's button) shows what it had loaded.
    function cpSweepStop() {
      var s = cpSweep;
      if (!s) return Promise.resolve();
      s.aborted = true;
      return (s.busy || Promise.resolve()).then(function () {}, function () {});
    }
    function cpSweepCancel() {
      if (cpSweep) cpSweep.cancelled = true;
      return cpSweepStop();
    }
    window.cpSweepStop = cpSweepStop;

    // What to sweep: the page's own criteria (the rows of its search form that have a value) and the field whose
    // prefixes split the list. Names first, where the list has them (they spread best); then an ID field, which
    // every record has, for what a name sweep leaves behind. Department and other pick-list fields cannot be
    // searched by prefix.
    function cpSweepPlan(form) {
      var keySel = form.querySelector('select[name="findKey0"]');
      if (!keySel || keySel.matches(':disabled')) return null;
      var fields = [].slice.call(keySel.options).filter(function (o) { return !o.matches(':disabled'); }).map(function (o) {
        return { value: o.value, label: (o.textContent || "").replace(/\s+/g, " ").trim() };
      }).filter(function (f) { return f.value && !/^Exact|Trunk/i.test(f.value); });
      var label = function (key) { var f = [].slice.call(keySel.options).filter(function (o) { return o.value === key; })[0]; return f ? (f.textContent || "").replace(/\s+/g, " ").trim() : key; };
      var rowNum = parseInt((form.querySelector('[name="rowNum"]') || {}).value, 10) || 0;
      var crit = [];
      for (var i = 0; i <= rowNum; i++) {
        var k = form.querySelector('[name="findKey' + i + '"]'), o = form.querySelector('[name="findOp' + i + '"]');
        var v = form.querySelector('[name="findValue' + i + '"]');
        if (!k || !v || !String(v.value || "").trim()) continue;
        var opEl = o && o.options ? o.options[o.selectedIndex] : null;
        var valEl = v.options ? v.options[v.selectedIndex] : null;
        crit.push({ key: k.value, op: o ? o.value : "STARTS_WITH", value: v.value, field: label(k.value),
          opLabel: opEl ? (opEl.textContent || "").trim() : "starts with", shown: valEl ? (valEl.textContent || "").trim() : v.value });
      }
      var usable = function (key) { return fields.some(function (f) { return f.value === key; }); };
      var plan = { total: null, crit: crit, original: crit.map(function (c) { return { key: c.key, op: c.op, value: c.value }; }) };
      if (crit.length === 1 && crit[0].op === "STARTS_WITH" && usable(crit[0].key)) {
        plan.part = crit[0].key;
        plan.seed = String(crit[0].value).toLowerCase();
        plan.base = [];
      } else {
        var used = crit.map(function (c) { return c.key; });
        var free = fields.filter(function (f) { return used.indexOf(f.value) === -1; });
        var pick = CP_SWP_PREFER.filter(function (k) { return free.some(function (f) { return f.value === k; }); })[0] ||
          (free.filter(function (f) { return /name/i.test(f.value); })[0] || free[0] || {}).value;
        if (!pick) return null;
        plan.part = pick;
        plan.seed = null;
        plan.base = plan.original;
      }
      plan.partLabel = label(plan.part);
      var ids = fields.filter(function (f) { return /id$/i.test(f.value) && f.value !== plan.part && plan.base.every(function (c) { return c.key !== f.value; }); });
      if (ids.length) { plan.idField = ids[0].value; plan.idLabel = ids[0].label; }
      return plan;
    }

    // One search, sent when nothing else is in flight; its answer's rows are collected as its pages arrive.
    function cpSweepIdle(s) {
      return new Promise(function (resolve, reject) {
        (function idle() {
          if (s.aborted) { reject(new Error("stopped")); return; }
          if (cpInflightPosts === 0 && !cpNavPending) { resolve(); return; }
          setTimeout(idle, 50);
        })();
      });
    }
    function cpSweepWait(s, ms) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () { if (s.aborted) reject(new Error("stopped")); else resolve(); }, ms);
      });
    }
    function cpSweepSearch(s, criteria) {
      return cpSweepIdle(s).then(function () {
        s.searches++;
        s.busy = cpListSearchRun(criteria, { signal: s, onDoc: function (doc) { cpSweepCollect(s, doc); } });
        return s.busy;
      }).then(function (res) { s.busy = null; s.fails = 0; return res; }, function (e) { s.busy = null; throw e; });
    }
    function cpSweepTry(s, criteria) {
      return cpSweepSearch(s, criteria).catch(function (e) {
        if (s.aborted) throw e;
        return cpSweepWait(s, 1500).then(function () { return cpSweepSearch(s, criteria); }).catch(function (e2) {
          if (s.aborted) throw e2;
          if (++s.fails >= 2) throw new Error("failed");
          s.missed.push(criteria[criteria.length - 1].value);
          return null;
        });
      });
    }
    function cpSweepCollect(s, doc) {
      var rows = doc.querySelectorAll('tr[id^="Row"]');
      if (!rows.length) return;
      if (!s.head) {
        var t = rows[0].closest("table"), h = t && t.querySelector("tr:has(> td.listHeader)");
        if (h) { s.head = document.importNode(h, true); s.head.querySelectorAll("script").forEach(function (sc) { sc.remove(); }); }
      }
      rows.forEach(function (src) {
        var drill = cpRowDrill(src);
        var key = drill ? drill.url + " " + JSON.stringify(drill.params)
          : [].slice.call(src.querySelectorAll("td")).map(function (td) { return (td.textContent || "").trim(); }).join("|");
        if (s.seen[key]) return;
        s.seen[key] = 1;
        var tr = document.importNode(src, true);
        tr.querySelectorAll("script").forEach(function (sc) { sc.remove(); });
        var first = tr.querySelector("a.tableLink") || tr;
        s.rows.push({ tr: tr, drill: drill, sort: (first.textContent || "").replace(/\s+/g, " ").trim() });
      });
      cpSweepProgress(s);
    }

    // A prefix: its rows, or (still too many) the prefix itself as an exact value and then each longer prefix.
    function cpSweepKids(s, prefix) {
      if (s.idPass && /^\d+$/.test(prefix)) return CP_SWP_DIGITS;
      return prefix.slice(-1) === " " ? CP_SWP_BASE : CP_SWP_ALL;
    }
    function cpSweepBucket(s, prefix, depth, parentCount) {
      if (s.aborted) return Promise.reject(new Error("stopped"));
      if (s.total != null && s.rows.length >= s.total) return Promise.resolve();   // everything is in
      s.prefix = prefix;
      cpSweepStatus(s);
      return cpSweepTry(s, s.base.concat([{ key: s.part, op: "STARTS_WITH", value: prefix }])).then(function (res) {
        if (!res || !res.tooMany) return;
        var n = res.matchCount;
        // A longer prefix that matches as many as its parent does not narrow the list: it would recurse forever.
        if (depth >= CP_SWP_DEPTH || (parentCount != null && n != null && n >= parentCount && prefix.slice(-1) !== " ")) {
          s.missed.push(prefix);
          return;
        }
        var seq = cpSweepTry(s, s.base.concat([{ key: s.part, op: "EQUAL_TO", value: prefix }]));
        cpSweepKids(s, prefix).forEach(function (ch) {
          seq = seq.then(function () { return cpSweepBucket(s, prefix + ch, depth + 1, n); });
        });
        return seq;
      });
    }
    function cpSweepRun(s) {
      var seq = Promise.resolve();
      if (s.seed != null) seq = cpSweepTry(s, [{ key: s.part, op: "EQUAL_TO", value: s.seed }]);
      s.tops.forEach(function (p, i) {
        seq = seq.then(function () { s.top = i; return cpSweepBucket(s, p, p.length, null); });
      });
      return seq;
    }

    // The view. The card takes the place of the (missing) results under the search; the sweep's progress and
    // status write into it; at the end it gives way to the rows.
    function cpSweepCard(state, html) {
      var card = state.card;
      card.className = "cp-sweep cp-sweep-" + state.phase;
      card.innerHTML = html;
      return card;
    }
    // The sweep is a long load: the logo's heartbeat line (the loading bar, cpProgress) runs with it, by the rows
    // loaded, and its dot pings when they are shown. A page loading meanwhile keeps the line for itself.
    function cpSweepBar(frac) {
      if (cpProgress.timer) return;
      clearTimeout(cpProgress.fade);
      document.documentElement.setAttribute("data-cp-progress", "on");
      cpProgressShow(Math.max(0.02, Math.min(0.98, frac)));
    }
    function cpSweepBarEnd(done) {
      var root = document.documentElement;
      if (cpProgress.timer || root.getAttribute("data-cp-progress") !== "on") return;
      if (!done) { root.removeAttribute("data-cp-progress"); return; }
      cpProgressShow(1);
      root.setAttribute("data-cp-progress", "done");
      cpProgress.fade = setTimeout(function () { root.removeAttribute("data-cp-progress"); }, 1200);
    }
    function cpSweepOfferCard(state) {
      var t = state.plan.total;
      // About a request per 20 rows, one per prefix, and splits under the busy ones; CommPilot answers a big
      // list's search in a few tenths of a second.
      var eta = t != null ? cpSweepMinutes((Math.ceil(t / 20) + 70 + Math.ceil(t / 1000) * 36) * 0.4) : null;
      state.phase = "offer";
      var card = cpSweepCard(state,
        '<div class="cp-sweep-ico">' + CP_SWP_SVG.funnel + '</div>' +
        '<h3 class="cp-sweep-h">Too many results for one search</h3>' +
        '<p class="cp-sweep-s">' + (t != null ? 'There are <b>' + cpSweepNum(t) + '</b> matching records. ' : 'There are too many matching records. ') +
          'CommPilot lists them only a few at a time: narrow the search above, or load them all' + (eta ? ', ' + eta : '') + '.</p>' +
        '<button type="button" class="cp-sweep-go">' + CP_SWP_SVG.search + '<span>Load all' + (t != null ? ' ' + cpSweepNum(t) : '') + '</span></button>');
      card.querySelector(".cp-sweep-go").addEventListener("click", function () { cpSweepStart(state, false); });
    }
    function cpSweepRunCard(state, s) {
      state.phase = "run";
      var chips = s.tops.map(function (p) {
        var spec = CP_SWP_SPECIALS.indexOf(p.slice(-1)) !== -1;
        return '<span class="cp-sweep-tk' + (spec ? ' cp-sweep-tk-spec' : '') + (p.length > 1 ? ' cp-sweep-tk-two' : '') + '">' + cpSweepEsc(p.split("").map(cpSweepChar).join("")) + '</span>';
      }).join("");
      var crit = s.idPass ? [] : state.plan.crit;
      var target = s.idPass ? (s.total != null ? s.total - s.startRows : null) : s.total;
      var card = cpSweepCard(state,
        '<div class="cp-sweep-ico">' + CP_SWP_SVG.search + '</div>' +
        '<h3 class="cp-sweep-h">' + (s.idPass ? 'Looking for the other ' + (target != null ? cpSweepNum(target) + ' ' : '') + 'by ' + cpSweepEsc(s.partLabel)
          : 'Loading all ' + (target != null ? cpSweepNum(target) + ' ' : '') + 'results…') + '</h3>' +
        (crit.length ? '<div class="cp-sweep-crit">' + crit.map(function (c) {
          return '<span class="cp-sweep-chip"><b>' + cpSweepEsc(c.field) + '</b><i>' + cpSweepEsc(String(c.opLabel).toLowerCase()) + '</i><span>' + cpSweepEsc(c.shown) + '</span></span>';
        }).join("") + '</div>' : '') +
        '<div class="cp-sweep-bar" role="progressbar" aria-label="Loaded" aria-valuemin="0" aria-valuemax="100"><div class="cp-sweep-fill"></div></div>' +
        '<div class="cp-sweep-n"></div>' +
        '<div class="cp-sweep-trackwrap">' + (s.seed != null ? '<span class="cp-sweep-pin">' + cpSweepEsc(s.seed.split("").map(cpSweepChar).join("")) + ' ›</span>' : '') +
          '<div class="cp-sweep-track">' + chips + '</div></div>' +
        '<div class="cp-sweep-sub" aria-live="off"></div>' +
        '<p class="cp-sweep-s cp-sweep-eta"></p>' +
        '<button type="button" class="cp-sweep-cancel">' + CP_SWP_SVG.x + '<span>Cancel</span></button>');
      card.querySelector(".cp-sweep-cancel").addEventListener("click", function () { cpSweepCancel(); });
      cpSweepProgress(s);
      cpSweepStatus(s);
    }
    function cpSweepProgress(s) {
      var card = s.state.card;
      if (s.state.phase !== "run" || !card.isConnected) return;
      var got = s.rows.length - s.startRows, target = s.idPass ? (s.total != null ? s.total - s.startRows : null) : s.total;
      var n = card.querySelector(".cp-sweep-n"), fill = card.querySelector(".cp-sweep-fill"), bar = card.querySelector(".cp-sweep-bar");
      if (n) n.innerHTML = cpSweepNum(got) + (target != null ? ' <i>of ' + cpSweepNum(target) + (s.idPass ? ' found' : '') + '</i>' : ' <i>found</i>');
      var pct = target ? Math.min(100, Math.round(got / target * 1000) / 10) : 0;
      if (fill) fill.style.setProperty("width", pct + "%");   // CSSOM: the page's policy blocks style attributes
      if (target) cpSweepBar(got / target);
      if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
      var eta = card.querySelector(".cp-sweep-eta");
      if (eta) {
        var secs = (Date.now() - s.began) / 1000, left = null;
        if (target != null && got > 40 && secs > 4) left = (target - got) / (got / secs);
        eta.textContent = (left != null && left > 0 ? cpSweepMinutes(left).replace(/^about /, "About ").replace(/^under/, "Under") + " left. " : "") +
          "Keep this tab open; opening another page stops the load.";
      }
    }
    function cpSweepStatus(s) {
      var card = s.state.card;
      if (s.state.phase !== "run" || !card.isConnected) return;
      card.querySelectorAll(".cp-sweep-tk").forEach(function (tk, i) {
        tk.classList.toggle("done", i < s.top);
        tk.classList.toggle("cur", i === s.top);
      });
      var sub = card.querySelector(".cp-sweep-sub"), top = s.tops[s.top];
      if (sub && top != null) {
        var shown = function (p) { return cpSweepEsc(p.split("").map(cpSweepChar).join("")); };
        sub.innerHTML = 'Searching ' + cpSweepEsc(s.partLabel) + ' <span class="cp-sweep-pp">' + shown(top) + '</span>' +
          (s.prefix && s.prefix !== top ? ' › <span class="cp-sweep-pill">' + shown(s.prefix) + '</span>' : '');
      }
    }

    // The rows as one native result table, and a toast saying what was loaded.
    function cpSweepShow(state, s, status) {
      if (!state.card.isConnected) return;
      var old = state.cell.querySelector(".cp-sweep-table");
      if (old) {   // the list shown before (a second pass): it goes with the pager lists.js put after it
        var pager = old.nextElementSibling;
        if (pager && pager.classList.contains("cp-pager")) pager.remove();
        var heading = old.previousElementSibling;   // and the count and Export lists.js put before it
        if (heading && heading.classList.contains("cp-results-heading")) heading.remove();
        old.remove();
      }
      var total = s.total, got = s.rows.length, gap = total != null ? total - got : 0;
      var took = Math.round((Date.now() - state.began) / 1000);
      took = took < 60 ? took + " s" : Math.floor(took / 60) + " min " + (took % 60) + " s";
      // What was loaded, as one of pjax.js's notices: toasts.js shows it at the bottom of the window like any other,
      // a note that goes by itself, or a warning whose button (the next step) keeps it until used.
      var kind = "info", title, body, act = null;
      if (status === "stopped") {
        kind = "warning"; title = "Loading stopped"; body = cpSweepNum(got) + " of " + cpSweepNum(total) + " loaded.";
      } else if (status === "failed") {
        kind = "error"; title = "CommPilot stopped answering";
        body = cpSweepNum(got) + " of " + cpSweepNum(total) + " loaded. If this keeps happening, sign in again.";
      } else if (gap > 0) {
        kind = "warning"; title = "Some results are missing";
        body = cpSweepNum(got) + " of " + cpSweepNum(total) + " loaded. " + cpSweepNum(gap) + " could not be reached by " + s.partLabel + ".";
      } else if (total == null) {
        // Some native 4027 responses omit the count. Exhausting the prefixes
        // cannot prove completeness, particularly after a failed search range.
        if (s.missed.length) {
          kind = "warning"; title = "Some searches did not finish";
          body = cpSweepNum(got) + " loaded. " + cpSweepNum(s.missed.length) + " search ranges could not be fully checked.";
        } else {
          title = "Search finished";
          body = cpSweepNum(got) + " loaded in " + took + ". CommPilot did not provide a total count.";
        }
      } else {
        title = "All results loaded";
        body = cpSweepNum(got) + " loaded in " + took + ", " + cpSweepNum(state.searches) + " searches.";
      }
      if (status !== "done") act = { text: "Load all again", run: function () {
        state.rows = []; state.seen = {}; state.head = null; state.began = 0; state.searches = 0;
        cpSweepStart(state, false);
      } };
      else if (gap > 0 && state.plan.idField && !s.idPass) act = { text: "Find the other " + cpSweepNum(gap) + " by " + state.plan.idLabel,
        run: function () { cpSweepStart(state, true); } };
      else if (total == null && state.plan.idField && !s.idPass) act = { text: "Search by " + state.plan.idLabel,
        run: function () { cpSweepStart(state, true); } };
      var note = document.createElement("div");
      note.className = "cp-alert cp-alert-" + kind;
      note.innerHTML = '<div class="cp-alert-content"><div class="cp-alert-title"></div><div class="cp-alert-body"></div></div>';
      note.querySelector(".cp-alert-title").textContent = title;
      note.querySelector(".cp-alert-body").textContent = body;
      if (act) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "cp-alert-act";
        button.textContent = act.text;
        button.addEventListener("click", function () { if (state.card.isConnected) act.run(); });
        note.append(button);
      }
      state.phase = "shown";
      state.card.className = "cp-sweep cp-sweep-shown";
      state.card.textContent = "";
      state.card.append(note);
      if (!s.head || !got) return;
      // CommPilot's own order: its first column, as it sorts a list.
      var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      var rows = s.rows.slice().sort(function (a, b) { return collator.compare(a.sort, b.sort); });
      var table = document.createElement("table");
      table.className = "cp-sweep-table";
      table.setAttribute("width", "100%");
      table.setAttribute("border", "0");
      table.setAttribute("cellpadding", "2");
      table.setAttribute("cellspacing", "0");
      var body = document.createElement("tbody");
      body.append(s.head.cloneNode(true));
      // Only CommPilot's first page goes in the page. With a palette, lists.js pages the list and the other rows
      // wait for it outside the page, in a <template> (thousands of rows in the page, even hidden, slow everything
      // on it); without one, they go in the page too, hidden until lists.js fits the list to the window.
      var paged = !!document.documentElement.getAttribute("data-cp-direction") && document.body.id === "initBody.menuTemplate";
      var held = paged ? document.createElement("template") : null;
      if (held) held.className = "cp-rows-held";
      rows.forEach(function (r, i) {
        var tr = r.tr, oldId = tr.id;
        tr.id = "Row" + (i + 1);
        tr.querySelectorAll("[id]").forEach(function (el) {
          if (el.id.indexOf(oldId + "Col") === 0) el.id = tr.id + el.id.slice(oldId.length);
        });
        tr.classList.toggle("cp-row-off", i >= 20 && !held);
        if (r.drill && !tr.hasAttribute("data-cp-drill")) {
          tr.setAttribute("data-cp-drill", "1");
          tr.querySelectorAll("a").forEach(function (a) {
            a.addEventListener("click", function () { window.redirectPost(r.drill.url, r.drill.params); });
          });
        }
        (i >= 20 && held ? held.content : body).append(tr);
      });
      table.append(body);
      if (held) table.append(held);
      table.setAttribute("data-cp-rows", String(rows.length));
      state.card.after(table);
      document.dispatchEvent(new CustomEvent("cp:list-fill"));   // lists.js pages and sorts it like any list
      // lists.js owns the complete-results reveal; do not stagger individual
      // rows after the finished table has been formatted and paged.
    }

    // Start (or, idPass, continue by the ID field for what the name sweep left behind).
    function cpSweepStart(state, idPass) {
      if (cpSweep && !cpSweep.restore) return;   // (a restoring search still in flight is waited for)
      var plan = state.plan;
      var s = {
        state: state, aborted: false, busy: null, fails: 0, missed: [], searches: 0, began: Date.now(), top: 0, prefix: "",
        total: plan.total, idPass: idPass,
        head: state.head || null, rows: state.rows || [], seen: state.seen || {},
        part: idPass ? plan.idField : plan.part, partLabel: idPass ? plan.idLabel : plan.partLabel,
        base: idPass ? plan.original : plan.base, seed: idPass ? null : plan.seed
      };
      s.startRows = s.rows.length;
      s.tops = s.seed != null ? cpSweepKids(s, s.seed).map(function (ch) { return s.seed + ch; }) : CP_SWP_TOP.slice();
      if (!state.began) state.began = s.began;
      state.searches = state.searches || 0;
      cpSweep = s;
      cpSweepRunCard(state, s);
      var finish = function (status) {
        if (cpSweep === s) cpSweep = null;
        state.head = s.head; state.rows = s.rows; state.seen = s.seen;
        state.searches += s.searches;
        cpSweepBarEnd(status === "done");
        cpSweepShow(state, s, status);
      };
      cpSweepRun(s).then(function () { return "done"; }, function (e) { return s.aborted ? "stopped" : "failed"; })
        .then(function (status) {
          // Something else stopped it (navigation, Reload, an upload): leave everything as it is.
          if ((status === "stopped" && !s.cancelled) || !state.card.isConnected) { if (cpSweep === s) cpSweep = null; return; }
          finish(status);
          // Put CommPilot's own list state back to the page's search (its answer is the same "too many").
          if (status !== "failed") {
            var r = { restore: true, aborted: false, busy: null, fails: 0, missed: [], searches: 0, rows: [], seen: {}, state: state };
            cpSweep = r;
            cpSweepSearch(r, plan.original).then(function () {}, function () {}).then(function () { if (cpSweep === r) cpSweep = null; });
          }
        });
    }

    // The offer, on a list page whose search CommPilot answered with "too many".
    function cpSweepOffer() {
      if (cpBulkOwner) return;
      if (window !== window.top) return;
      if (cpSweep && !cpSweep.state.card.isConnected) cpSweepStop();
      var cell = document.querySelector('td[width="82%"]');
      if (!cell || cell.querySelector(".cp-sweep")) return;
      var search = cell.querySelector("#searchTable"), form = document.querySelector('form[name="mainForm"]');
      if (!search || !form) return;
      var err = [].slice.call(cell.querySelectorAll("td.error")).filter(function (td) {
        return /Error\s*4027|narrow\s+your\s+search/i.test(td.textContent || "");
      })[0];
      if (!err) return;
      var plan = cpSweepPlan(form);
      if (!plan) return;
      var m = /there\s+are\s+([\d,]+)\s+matching/i.exec(err.textContent || "");
      plan.total = m ? +m[1].replace(/,/g, "") : null;
      err.setAttribute("data-cp-toast", "sweep");   // the card says it (toasts.js leaves it alone; toasts.css hides it)
      var card = document.createElement("section");
      (search.closest(".cp-searchbar-wrap") || search).after(card);
      cpSweepOfferCard({ card: card, cell: cell, plan: plan });
    }
    if (window === window.top) {
      document.addEventListener("cp:reskin", cpSweepOffer);
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cpSweepOffer, { once: true });
      else cpSweepOffer();
    }

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
      var fieldOpts = keySel ? [].slice.call(keySel.options).map(function (o) { return { value: o.value, label: (o.textContent || "").trim() }; }) : [];
      var opOpts = opSel ? [].slice.call(opSel.options).map(function (o) { return { value: o.value, label: (o.textContent || "").trim() }; }) : [];
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
    function cpElementWiring(el, doc) {
      if (!el) return [];
      var chunks = [], inline = el.getAttribute && el.getAttribute('onclick');
      if (inline) chunks.push(inline);
      if (!el.id) return chunks;
      var root = doc || document;
      var current = el.closest && el.closest('td[width="82%"]');
      var scopes = current && current !== root && root.contains(current) ? [current, root] : [root];
      // The initial page's head can retain wiring for an ID reused after a
      // content swap. Prefer this control's current content, with page-wide
      // wiring still available when the native handler lives outside it.
      scopes.forEach(function (scope, index) {
        scope.querySelectorAll('script:not([src])').forEach(function (script) {
          if (index && current.contains(script)) return;
          var text = script.textContent || '';
          // Most list scripts belong to another row. Avoid tokenizing all of
          // them, but still inspect IDs written with JavaScript escapes.
          if (text.indexOf(el.id) === -1 &&
              !/\bgetElementById\s*\(\s*(?:'[^'\\]*\\|"[^"\\]*\\)/.test(text)) return;
          if (!cpNativeInlineScript(script)) return;
          cpScriptBindings(text).forEach(function (binding) {
            if (binding.id === el.id) chunks.push(binding.script);
          });
        });
      });
      return chunks;
    }
    function cpScriptBindings(text) {
      // Native handlers use one getElementById binding per action. A binding
      // without navigation must not inherit the next control's target.
      var bindings = [], match;
      var re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\bgetElementById\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*\)/g;
      while ((match = re.exec(text))) {
        if (match[1] !== undefined || match[2] !== undefined)
          bindings.push({ id: cpUnescapeJs(match[1] === undefined ? match[2] : match[1]), start: match.index, end: re.lastIndex });
      }
      return bindings.map(function (binding, index) {
        return { id: binding.id, script: text.slice(binding.end, bindings[index + 1] ? bindings[index + 1].start : text.length) };
      });
    }
    function cpGridActionTarget(el, doc) {
      var chunks = cpElementWiring(el, doc);
      for (var i = 0; i < chunks.length; i++) {
        var target = cpParseNativeRedirect(chunks[i]);
        if (target) return target;
      }
      return null;
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
      var chunks = cpElementWiring(el);
      for (var i = 0; i < chunks.length; i++) {
        // Keep each argument's own quote delimiter and decode escapes once.
        // A device type may contain an apostrophe, quote or literal backslash.
        var m = /\bexportComponent\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*,\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*,\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*,\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*\)/.exec(chunks[i]);
        if (m) return {
          component: cpUnescapeJs(m[1] === undefined ? m[2] : m[1]),
          contextPath: cpUnescapeJs(m[3] === undefined ? m[4] : m[3]),
          pagePath: cpUnescapeJs(m[5] === undefined ? m[6] : m[5]),
          tokenName: cpUnescapeJs(m[7] === undefined ? m[8] : m[7])
        };
      }
      return null;
    }
    // Replicates legacy exportComponent (deviceManagementExport.js) but downloads via a BLOB instead of
    // `location.href = proxy`. The proxy is a /commpilot/ URL, so the legacy GET nav would be caught by our DNR
    // recovery redirect (GET main_frame) → styles.css → no download. Fetch+blob+<a download> never touches
    // main_frame, so DNR can't interfere. Server contract (verified): POST <pagePath>/index.jsp?key=<component>
    // &export=&<tokenName>=<token> → body has <proxy>URL</proxy>; GET that URL → the file (Content-Disposition).
    var cpComponentExportActive = false;
    function cpExportComponent(component, contextPath, pagePath, tokenName) {
      if (cpComponentExportActive) return;
      if (cpInflightPosts || cpNavPending || cpBulkOwner) {
        cpUploadNotice('Wait for the current operation to finish before exporting.'); return;
      }
      cpComponentExportActive = true;
      cpInflightPosts++;
      var controller = new AbortController();
      var deadline = setTimeout(function () { controller.abort(); }, 300000);
      function release() {
        clearTimeout(deadline);
        cpComponentExportActive = false;
        cpInflightPosts = Math.max(0, cpInflightPosts - 1);
      }
      function failed(err) {
        cpUploadNotice(controller.signal.aborted ? 'The export timed out. No download was saved. Try exporting again.' :
          'The export could not be downloaded. ' + (err && err.message || 'Check the connection and try again.'));
      }
      function checked(response) {
        if (response.type === 'opaqueredirect' || !response.status || response.status >= 300)
          throw new Error(response.status ? 'The server returned HTTP ' + response.status + '.' : 'The server redirected the download.');
        return response;
      }
      try {
        var tokEl = (document.mainForm && document.mainForm.elements[tokenName]) || document.getElementsByName(tokenName)[0];
        var tok = tokEl ? tokEl.value : "";
        var postUrl = contextPath + pagePath + "/index.jsp?key=" + encodeURIComponent(component) + "&export=";
        var addressError = cpNavigationAddressError(postUrl);
        if (addressError) throw new Error(addressError);
        if (tok) postUrl += "&" + tokenName + "=" + encodeURIComponent(tok);
        fetch(postUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, credentials: "same-origin", redirect: "manual", signal: controller.signal })
          .then(function (r) {
            return checked(r).text();
          })
          .then(function (txt) {
            var s = txt.indexOf("<proxy>"), e = txt.indexOf("</proxy>");
            if (s < 0 || e <= s) throw new Error('The server did not return a download link.');
            var proxy = txt.substring(s + 7, e);
            return fetch(proxy, { credentials: "same-origin", redirect: "manual", signal: controller.signal }).then(function (pr) {
              checked(pr);
              if (/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(pr.headers.get('content-type') || ''))
                throw new Error('The server returned a web page instead of an export file.');
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
          .catch(failed).finally(release);
      } catch (e) { try { failed(e); } finally { release(); } }
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
      if (cpUxpEl) {
        try { cpUxpEl.remove(); } catch (e) {}
        if (cpUxpEl._cpReleaseFocus) cpUxpEl._cpReleaseFocus();
      }
      cpUxpEl = null;
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
        var tds = [].slice.call(tr.children).filter(function (td) { return td.tagName === "TD"; });
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
        // TextEncoder emits UTF-8 names. Mark both ZIP records accordingly so
        // readers do not interpret international group names as legacy CP437.
        var lh = new Uint8Array([].concat([80, 75, 3, 4], u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0)));
        parts.push(lh, nb, data);
        cd.push({ nb: nb, crc: crc, sz: data.length, off: off });
        off += lh.length + nb.length + data.length;
      });
      var cdParts = [], cdSize = 0;
      cd.forEach(function (c) {
        var h = new Uint8Array([].concat([80, 75, 1, 2], u16(20), u16(20), u16(0x800), u16(0), u16(0), u16(0), u32(c.crc), u32(c.sz), u32(c.sz), u16(c.nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off)));
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
        .replace(/&apos;/g, "'").replace(/&#(x[0-9a-f]+|\d+);/gi, function (m, n) {
          var point = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n);
          return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : m;
        })
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
    function cpUxpReportFetch(deptValue, signal) {
      if (cpInflightPosts || cpNavPending || cpBulkOwner)
        return Promise.reject(new Error('Wait for the current operation to finish before exporting the directory.'));
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
      var controller = new AbortController(), expired = false;
      var cancelReport = function () { controller.abort(); };
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", cancelReport, { once: true });
      }
      var deadline = setTimeout(function () { expired = true; controller.abort(); }, 300000);
      cpInflightPosts++;
      return Promise.resolve().then(function () { return fetch(location.origin + CP_UXP_REPORT_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "same-origin", redirect: "manual", body: params.toString(), signal: controller.signal
      }); }).then(function (r) {
        if (r.status === 401) return { auth: false };
        if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300 && r.status < 400)
          throw new Error("The directory report was redirected; its result could not be confirmed");
        if (!r.ok) throw new Error("Directory report returned HTTP " + r.status);
        return r.text().then(function (txt) {
          if (/Please login again|not authorized to access the system|<form[^>]+(?:login|password)/i.test(txt)) return { auth: false };
          var report = cpUxpParseReport(txt);
          if (!report.headings.length) throw new Error("CommPilot did not return the directory report");
          return report;
        });
      }).catch(function (error) {
        if (expired) throw new Error("The directory report timed out. No request was replayed");
        throw error;
      }).finally(function () {
        clearTimeout(deadline);
        cpInflightPosts = Math.max(0, cpInflightPosts - 1);
        if (signal) signal.removeEventListener("abort", cancelReport);
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
      var counts = { total: typed.length, users: 0, service: 0, byType: Object.create(null) };
      typed.forEach(function (x) { if (x.isService) counts.service++; else counts.users++; counts.byType[x.type] = (counts.byType[x.type] || 0) + 1; });
      var kept = (mode === "users") ? typed.filter(function (x) { return !x.isService; }) : typed;
      // Sort by first name then last (A→Z).
      kept.sort(function (a, b) { var ka = firstLast(a.r).toLowerCase(), kb = firstLast(b.r).toLowerCase(); return ka < kb ? -1 : ka > kb ? 1 : 0; });
      // Group by department.
      var byDept = Object.create(null), deptNames = [];
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
      var used1 = Object.create(null), sheetsFull = [{ name: cpXlsxSheetName("All Users", used1), headers: fullHeaders, rows: allFullRows, widths: fullW, tabColor: "FFF58025" }];
      deptNames.forEach(function (d) { sheetsFull.push({ name: cpXlsxSheetName(d, used1), headers: fullHeaders, rows: byDept[d].map(fullRow), widths: fullW, tabColor: "FF5A2D82" }); });
      var used2 = Object.create(null), sheetsCust = [];
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
      var acc = { headings: null, rows: [], seenUid: Object.create(null) };
      var CP_UXP_CAPWARN = 950;   // a single department report at/over this may be server-capped
      var capWarns = [];

      var opt = function (val, checked, title, desc) {
        return '<label class="cp-uxp-opt"><input type="radio" name="cp-uxp-mode" value="' + val + '"' + (checked ? " checked" : "") + '/>' +
          '<span class="cp-uxp-optt"><b>' + title + '</b><span>' + desc + '</span></span></label>';
      };
      var back = document.createElement("div");
      back.className = "cp-modal-back";
      back.innerHTML =
        '<div class="cp-modal cp-uxp" role="dialog" aria-modal="true" aria-label="Export directory">' +
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
      back._cpReleaseFocus = window.cpFocusBulkDialog(back, { history: false, onEscape: cancel });
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
        if (halted() || !back.isConnected) return;
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
        cpUxpReportFetch(d.value, ac.signal).then(function (res) {
          if (halted()) return;
          if (res && res.auth === false) { fail("Session bounce fetching “" + d.label + "” — please sign in again, then retry."); return; }
          absorb(res, d.label);
          setN();
          stepDept();
        }).catch(function (e) { if (!halted()) fail("Report for “" + d.label + "” failed (" + String((e && e.message) || e) + ")."); });
      }
      function runBroad() {
        setH("Fetching the directory…"); setBar(0.4);
        cpUxpReportFetch(null, ac.signal).then(function (res) {
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
        cpFieldMetaCache = {};   // the department list is per group: read the page on screen, not an earlier group's
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
    function cpDeviceIdentity(form, fallback) {
      var identity = {}, nav = history.state && history.state.cpNav;
      var source = fallback || (cpDeviceProfileBase(location.pathname) && nav && nav.params) ||
        (cpDeviceProfileOrigin && cpDeviceProfileOrigin.identity) ||
        (cpSearchLandingNav && cpDeviceProfileBase(cpSearchLandingNav.url) && cpSearchLandingNav.params) || {};
      ['key', 'P_key', 'name', 'P_name'].forEach(function (field) {
        var input = form && form.elements.namedItem(field);
        if (input && input.value) identity[field] = input.value;
        else if (source[field]) identity[field] = source[field];
      });
      if (!identity.key) {
        var device = form && (form.elements.namedItem('deviceName') || form.elements.namedItem('origDeviceName'));
        identity.key = identity.name || identity.P_key || device && device.value || '';
      }
      if (!identity.key) return null;
      identity.P_key ||= identity.key;
      identity.name ||= identity.key;
      identity.P_name ||= identity.name;
      return identity;
    }
    function cpDeviceTrack(url, params) {
      var base = cpDeviceProfileBase(cpDeviceProfilePage(url,params));
      if (!base) return;
      if (cpPopReplaying && history.state && history.state.cpDeviceOrigin) {
        cpDeviceProfileOrigin = history.state.cpDeviceOrigin;
        try { sessionStorage.setItem('cp-device-origin',JSON.stringify(cpDeviceProfileOrigin)); } catch (e) {}
        return;
      }
      var painted = document.documentElement.getAttribute('data-cp-path') || location.pathname;
      var nav = history.state && history.state.cpNav;
      if (cpDeviceProfileBase(cpDeviceProfilePage(painted,nav && nav.params)) === base) {
        var requestedKey = cpDeviceProfileBase(url) && params && (params.key || params.P_key);
        if (cpDeviceProfileOrigin && requestedKey && cpDeviceProfileOrigin.identity &&
            requestedKey !== cpDeviceProfileOrigin.identity.key) {
          cpDeviceProfileOrigin = null;
          try { sessionStorage.removeItem('cp-device-origin'); } catch (e) {}
        }
        return;
      }
      var owner = nav && nav.params && nav.params.returnPage;
      var source = /\/commpilot\/Common\/find(?:All)?\.jsp$/.test(painted) && owner ?
        (owner.indexOf('/commpilot/') === 0 ? owner : '/commpilot' + owner) : painted;
      cpDeviceProfileOrigin = null;
      try { sessionStorage.removeItem('cp-device-origin'); } catch (e) {}
      if (!/^\/commpilot\/User\/(?:SCAP|Addresses)\//.test(source)) return;
      var back = nav && nav.url ? JSON.parse(JSON.stringify(nav)) : {url:painted,params:{}};
      if (!back.entry) {
        var entry = cpEntityEntry || cpDeepEntry;
        if (entry && /\/Group\/Members\/Modify\//.test(entry.url)) back.entry = {url:entry.url,params:entry.params || {}};
        else {
          var user = cpIdText(cpUserIdElement());
          if (user) back.entry = {url:'/commpilot/Group/Members/Modify/index.jsp',params:{key:user,P_key:user}};
        }
      }
      cpDeviceProfileOrigin = {base:base,back:back,identity:cpDeviceIdentity(null,params || {})};
      try { sessionStorage.setItem('cp-device-origin',JSON.stringify(cpDeviceProfileOrigin)); } catch (e) {}
    }
    function cpContextNavEnd(nav) {
      if (!nav || cpContextNavActive !== nav) return;
      cpContextNavActive = null;
      if (cpAutoReplaceUrl === nav.url) cpAutoReplaceUrl = null;
      if (nav.onSettled) nav.onSettled();
    }
    // Recent locations contain read-only navigation only, never a form snapshot or its single-use token.
    var cpRecentKey = 'cp-recent-locations';
    var cpRecentCurrent = null, cpRecentNeedsContext = false, cpRecentBlocked = [];
    function cpRecentBlock(block) {
      cpRecentNeedsContext = block;
      if (block && !cpRecentBlocked.length) {
        document.querySelectorAll('td[width="82%"] input[type="submit"], td[width="82%"] button[type="submit"], td[width="82%"] input[name="delete"][type="button"]').forEach(function(button){
          cpRecentBlocked.push({el:button,disabled:button.disabled}); button.disabled = true;
        });
      } else if (!block) {
        cpRecentBlocked.forEach(function(button){button.el.disabled = button.disabled;}); cpRecentBlocked = [];
      }
    }
    function cpRecentNav(nav) {
      // Native route names are literal; identifiers belong in the parameters.
      // Encoded paths and dot segments can otherwise evade the mutation denylist
      // and fall through to native full-page navigation (including Logout).
      if (!nav || typeof nav !== 'object' || Array.isArray(nav) || typeof nav.url !== 'string') return null;
      var route = nav.url.split('?')[0];
      if (!/^\/commpilot\/[A-Za-z0-9_/.-]+$/.test(route) || nav.url.indexOf('#') !== -1 ||
          /(?:^|\/)\.{1,2}(?:\/|$)/.test(route) ||
          /^\/commpilot\/Common\/(?:page|sort)\.jsp$/.test(route) ||
          /\/(?:Login|Logout|servlet|Add|AddRange|AddModify|Import|Delete)(?:\/|$)/i.test(route)) return null;
      // These native flags select a read-only tab. Unknown query actions are not replayable.
      if (route !== nav.url) {
        var query = new URLSearchParams(nav.url.slice(route.length + 1)), queryNames = new Set();
        for (var pair of query) {
          if (!/^(?:TransferForward|isEnh|UserLevel|selectedTab|tabPage)$/.test(pair[0]) ||
              !/^[A-Za-z0-9_.-]{0,80}$/.test(pair[1]) || queryNames.has(pair[0])) return null;
          queryNames.add(pair[0]);
        }
        if (!queryNames.size) return null;
      }
      var params = {}, source = nav.params || {};
      if (typeof source !== 'object' || Array.isArray(source)) return null;
      if (['ok','apply','delete','cancel'].some(function (key) { return source[key] != null; }) ||
          /^(ok|apply|delete|cancel)$/i.test(source.buttonClicked || '')) return null;
      Object.keys(source).sort().forEach(function (key) {
        if (/^(?:key|P_key|name|P_name|id|P_id|userId|P_userId|groupId|P_groupId|serviceProviderId|P_serviceProviderId|enterpriseId|criteriaName|policyName|scheduleName|eventName|serviceName|serviceInstanceName|deviceName|instanceId|type|selectedTab|folder|menuId|P_menuId|returnPage|tableName|tabPage|op|value|findKey\d*|findOp\d*|findValue\d*)$/.test(key) &&
            typeof source[key] !== 'object' && String(source[key]).length <= 2048) params[key] = String(source[key]);
      });
      return {url:nav.url,params:params};
    }
    function cpRecentRead() {
      try { var rows = JSON.parse(sessionStorage.getItem(cpRecentKey) || '[]'); return Array.isArray(rows) ? rows.filter(function (row) {return row && typeof row.id === 'string' && row.nav;}).slice(0,30) : []; }
      catch (e) { return []; }
    }
    function cpRecentContext(nav) {
      var chain = [], header = [].slice.call(document.querySelectorAll('td.headerBar')).find(function (td) {
        return td.querySelector('a.headerAuthLevelLink, span.headerAuthLevel');
      });
      var names = header ? [].slice.call(header.querySelectorAll('a.headerAuthLevelLink')).map(function (el) { return (el.textContent || '').trim(); }).filter(function (s) {return s && s !== 'Users';}) : [];
      var entity = header && header.querySelector('span.headerAuthLevel');
      var id = entity && (entity.textContent || '').replace(/^\s*:\s*/,'').trim();
      var level = /\/Group\/Members\/Modify\//.test(nav.url) ? 'U' :
        /\/(?:ServiceProvider\/Members|Reseller\/Groups)\/Modify\//.test(nav.url) ? 'G' :
        /\/ServiceProviders\/Modify\//.test(nav.url) ? 'S' : cpNavLevel(nav) || cpSidebarLevel();
      // Native breadcrumb keys use the same SP>%Group>%User composite as cpCrumbNav. Rebuild the complete
      // ancestry, including when the extension starts on a user page rather than visiting its parents first.
      if (/^Reseller$/i.test(names[0] || '')) {
        chain.push({url:'/commpilot/Common/folder_contents.jsp',params:{folder:'R0',menuId:'8'}});
        var sp = names[1] || (level === 'S' ? id : '');
        var group = names[2] || (level === 'G' ? id : '');
        if (sp && level !== 'R') chain.push({url:'/commpilot/Reseller/ServiceProviders/Modify/index.jsp',params:{key:sp,P_key:sp}});
        if (sp && group && (level === 'G' || level === 'U')) {
          var groupKey = sp + '>%' + group;
          chain.push({url:'/commpilot/ServiceProvider/Members/Modify/index.jsp',params:{key:groupKey,P_key:groupKey}});
          if (level === 'U' && id) chain.push({url:'/commpilot/Group/Members/Modify/index.jsp',params:{key:groupKey + '>%' + id,P_key:groupKey + '>%' + id}});
        }
      }
      var entry = cpRecentNav(nav.entry || cpEntityEntry || cpDeepEntry);
      if (entry && entry.url !== nav.url) {
        var found = chain.findIndex(function (step) {return step.url === entry.url;});
        if (found >= 0) chain[found] = entry;
        else chain.push(entry);
      }
      return chain.filter(function (step) { return step.url !== nav.url; });
    }
    function cpRecentRecord() {
      if (cpBulkOwner || cpSignedOut) return;
      if (/\/(?:Login|Logout)\//.test(location.pathname) || cpPendingNav || cpContextNavActive || cpRecentNeedsContext || !document.querySelector('td[width="82%"]') ||
          document.querySelector('td[width="82%"] .error, td[width="82%"] .errorMsg, td[width="82%"] .Failure')) return;
      var raw = history.state && history.state.cpNav, nav = cpRecentNav(raw);
      if (!nav || nav.url !== location.pathname + location.search) return;
      // The page frame moves the description card and action buttons into the title cell. textContent
      // includes that hidden card too, so read a copy of just the title and strip its supporting UI.
      var title = document.querySelector('td[width="82%"] td.screenName');
      if (title) {
        title = (title.querySelector('.cp-frame-title') || title).cloneNode(true);
        title.querySelectorAll('.cp-frame-about, .cp-frame-actions, button, input, select, textarea, script, style, [role="tooltip"], [aria-hidden="true"]').forEach(function(el){el.remove();});
      }
      var label = ((title && title.textContent) || document.title || '').replace(/\s+/g,' ').trim();
      if (!label) return;
      var header = [].slice.call(document.querySelectorAll('td.headerBar')).find(function (td) {return td.querySelector('a.headerAuthLevelLink, span.headerAuthLevel');});
      var trail = header ? [].slice.call(header.querySelectorAll('a.headerAuthLevelLink, span.headerAuthLevel')).map(function (el) {return (el.textContent || '').replace(/^\s*:\s*/,'').trim();}).filter(function(s){return s && s !== 'Users';}) : [];
      var chain = cpRecentContext(raw), identity = JSON.stringify([nav,chain]);
      cpRecentCurrent = {nav:nav,chain:chain};
      try { history.replaceState(Object.assign({},history.state,{cpRecentChain:chain}),'',location.href); } catch(e) {}
      if (!cpPopReplaying && cpPaintedEntry.href === location.href) cpPaintedEntry.state = history.state;
      var record = {id:Date.now().toString(36) + Math.random().toString(36).slice(2,8),identity:identity,label:label.slice(0,160),context:trail.join(' › ').slice(0,500),nav:nav,chain:chain,at:Date.now(),
        isMenu:!!document.querySelector('.cp-console, td[width="82%"] a.navMenuItem'),extension:header?.querySelector('span.headerAuthLevel')?.getAttribute('data-cp-extension') || '',
        userName:header?.querySelector('span.headerAuthLevel')?.getAttribute('data-cp-user-name') ?? undefined};
      var rows = cpRecentRead().filter(function (row) {return row.identity !== record.identity;});
      rows.unshift(record);
      try { sessionStorage.setItem(cpRecentKey,JSON.stringify(rows.slice(0,30))); document.dispatchEvent(new Event('cp:recent-change')); } catch (e) {}
    }
    function cpRecentRestore(nav, entries) {
      var chain = entries.map(cpRecentNav);
      if (chain.some(function (step) {return !step;})) return;
      cpPendingNav = null;
      cpContextNavEnd(cpContextNavActive);
      cpRecentBlock(true);
      var restore = cpContextNavActive = {url:nav.url,entry:chain[chain.length - 1] || null,entries:chain,recent:true};
      cpHook(nav.url,nav.params,false,restore);
    }
    window.addEventListener('message',function (event) {
      if (event.source !== window || event.origin !== location.origin || !event.data) return;
      if (event.data.__cpRecentClear === true) {
        try {sessionStorage.removeItem(cpRecentKey);document.dispatchEvent(new Event('cp:recent-change'));} catch(e) {}
      }
      var row = cpRecentRead().find(function (item) {return item.id === event.data.__cpRecentOpen;});
      var nav = row && cpRecentNav(row.nav);
      if (!nav || !Array.isArray(row.chain) || row.chain.length > 5) return;
      var entries = row.chain;
      if (Number.isInteger(event.data.__cpRecentBase)) {
        // A location heading opens its saved entity entry, with only that entry's parents restored first.
        // Accept an index into the stored visit, never a new URL or parameters supplied by the message.
        var index = event.data.__cpRecentBase;
        if (index < 0 || index > entries.length) return;
        nav = cpRecentNav(entries.concat([row.nav])[index]);
        if (!nav || !(/\/(?:Group\/Members|ServiceProvider\/Members|Reseller\/Groups|ServiceProviders)\/Modify\//.test(nav.url) ||
            nav.url === '/commpilot/Common/folder_contents.jsp' && nav.params.folder === 'R0')) return;
        entries = entries.slice(0,index);
      }
      cpRecentRestore(nav,entries);
    });
    document.addEventListener('cp:recent-record',cpRecentRecord);
    document.addEventListener('cp:morphed',function(){setTimeout(cpRecentRecord,0);});
    setTimeout(cpRecentRecord,0);
    function cpDeviceReturn() {
      var origin = cpDeviceProfileOrigin;
      var page = cpDeviceProfilePage(location.pathname,history.state?.cpNav?.params);
      if (!origin || cpDeviceProfileBase(page) !== origin.base || !origin.back ||
          !/^\/commpilot\/(?:User\/(?:SCAP|Addresses)\/|Common\/find(?:All)?\.jsp)/.test(origin.back.url)) return false;
      if (cpContextNavActive) return true;
      var back = origin.back;
      // The entity entry restores CommPilot's server-side user context; it is not a destination. Painting
      // it first ran the user menu's scripts/aggregation and made the SCA return wait on those extra reads.
      // Keep both requests in one navigation, with only the final page allowed to repaint or enter history.
      var returnNav = cpContextNavActive = {url:back.url,entry:back.entry && back.entry.url !== back.url ? back.entry : null};
      cpAutoReplaceUrl = back.url;
      cpHook(back.url,back.params || {},false,returnNav);
      return true;
    }
    function cpDeviceSaved(action) {
      var page = cpDeviceProfilePage(location.pathname,history.state?.cpNav?.params);
      if (!page) return false;
      if (action === 'ok') return cpDeviceReturn();
      if (action !== 'apply') return false;
      var identity = cpDeviceIdentity(document.forms.mainForm,cpDeviceProfileOrigin && cpDeviceProfileOrigin.identity);
      if (!identity) return false;
      cpAutoReplaceUrl = page;
      cpHook(page,identity);
      return true;
    }
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
        var chunks = cpElementWiring(tabEl);
        for (var ti = 0; ti < chunks.length; ti++) {
          var tabMatch = /\b([Tt])abSubmit\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*\)/.exec(chunks[ti]);
          if (!tabMatch) continue;
          dialectLower = tabMatch[1] === 't';
          tabUrl = cpUnescapeJs(tabMatch[2] === undefined ? tabMatch[3] : tabMatch[2]);
          break;
        }
        var devicePage = cpDeviceProfilePage(location.pathname,history.state?.cpNav?.params);
        if (!tabUrl && devicePage && tabEl) {
          var direct = tabEl.id && cpWiringTargets(document)[tabEl.id];
          tabUrl = direct && direct.url || tabEl.getAttribute('href') || '';
          if (/^(?:javascript:|#)/i.test(tabUrl)) tabUrl = '';
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
        var deviceTarget;
        try { deviceTarget = new URL(/^\/(?:Group|ServiceProvider|Operator)\//.test(tabUrl) ? '/commpilot' + tabUrl : tabUrl,location.origin + (devicePage || location.pathname)).pathname; } catch (e) {}
        if (cpDeviceProfileBase(deviceTarget) && devicePage) {
          // The full Profile form POST to a sibling tab is interpreted as a
          // profile action and returns the list. Enter the tab with only the
          // profile identity instead; this is navigation, not a save.
          var identity = cpDeviceIdentity(form);
          if (!identity) return false;
          window.redirectPost(deviceTarget, identity);
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
      cpProgressStart();
      _searchP.then(cpProgressDone, cpProgressDone);
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
    // Keyed by findKey value; RESET per grid build (cpBuildSearchGrid) and per directory export Start because the
    // department list is per-group.
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
      var optsHtml = [].slice.call(sel.options).map(function (o, i) {
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
        function visOpts() { return [].slice.call(listEl.querySelectorAll(".cp-srch-ddopt")).filter(function (o) { return o.style.display !== "none"; }); }
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
            meta.options = [].slice.call(lv.options).map(function (o) { return { value: o.value, label: (o.textContent || "").trim() }; });
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
    // (what redirectPost itself would post). A failed or timed-out request leaves
    // the confirmation recoverable; only an explicit retry sends another POST.
    function cpSignOutFetch(url, params) {
      var start = Date.now();
      var LOGIN = "/commpilot/Login/";
      function go() {
        cpSignedOut = true;
        var wait = Math.max(0, CP_LOGOUT_MIN_MS - (Date.now() - start));
        setTimeout(function () {
          var navd = false;
          function nav() {
            if (navd) return; navd = true;
            // The session ended on purpose. Forget this tab's place to return to (the keys the recovery page's Go
            // to login clears), so the next sign-in here, possibly as another saved account, starts at home instead
            // of reopening this session's service provider. A failed sign-out never gets here and keeps them.
            ["cp-last-nav", "cp-pending-return", "cp-return-at", "cp-reload-nav", "cp-replay-at"].forEach(function (key) {
              try { sessionStorage.removeItem(key); } catch (e) {}
            });
            // So do Recent locations, and the Login page holds back saved sign-in for a moment (login.js).
            try { sessionStorage.removeItem(cpRecentKey); } catch (e) {}
            try { sessionStorage.setItem("bwManualLogoutAt", String(Date.now())); } catch (e) {}
            try { location.replace(LOGIN); } catch (e) { location.href = LOGIN; }
          }
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
      var controller = new AbortController(), timedOut = false;
      var deadline = setTimeout(function () { timedOut = true; controller.abort(); }, 30000);
      function failed(error) {
        clearTimeout(deadline);
        var message = timedOut ? "The request timed out." :
          error && error.cpLogoutAddress ? error.message :
          error && error.cpLogoutStatus ? "The server returned HTTP " + error.cpLogoutStatus + "." :
          "The request could not be completed.";
        document.dispatchEvent(new CustomEvent("cp:logout-failed", { detail: JSON.stringify({ message: message }) }));
      }
      try {
        var addressError = cpNavigationAddressError(url);
        if (addressError) {
          var addressFailure = new Error(addressError); addressFailure.cpLogoutAddress = true;
          failed(addressFailure); return;
        }
        var body = new URLSearchParams();
        for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) body.append(k, params[k]);
        var tEl = document.getElementsByName("formtokenserial")[0];
        if (tEl && tEl.value) body.append("formtokenserial", tEl.value);
        cpDbg("[pjax] sign-out fetch", url);
        // redirect:"manual" — a sign-out POST that the server answers with an http:// Login/Logout bounce means
        // the session is already gone; letting the browser follow that hop would CSP-fail (mixed content) → a
        // spurious connect-src violation. An opaqueredirect follows the existing successful logout contract.
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "same-origin",
          redirect: "manual",
          signal: controller.signal
        }).then(function (response) {
          clearTimeout(deadline);
          if (response.ok || response.type === "opaqueredirect" || response.status === 401) return go();
          var error = new Error("Sign-out failed"); error.cpLogoutStatus = response.status;
          failed(error);
        }, failed);
      } catch (e) { failed(e); }
    }

    // The loading bar. pjax.js swaps pages in place, so the browser shows no progress of its own; this does, from
    // the click until the page is on screen. It jumps a little at once, creeps toward the end while CommPilot
    // works (a slow page keeps visibly moving), then fills. The progress is published as <html data-cp-progress>
    // ("on", then "done" for a moment as the page lands) and --cp-progress (0 to 1) on the logo. The CommPilot
    // logo's heartbeat trace draws it (brand.js, theme-palettes.css): the line runs along the trace and the end dot
    // pings when the page lands. Only where the top bar has no logo does a thin accent bar run along the top of
    // the window instead. <html data-cp-nav="busy"> marks a navigation (page-baseline.css eases the page back).
    // The variable stays off <html>: every element would inherit it and be restyled on each tick (a third of a
    // second a tick on a page with a 17,270-option select, for the whole wait).
    var cpProgress = { el: null, value: 0, timer: 0, fade: 0 };
    function cpProgressShow(value) {
      var p = cpProgress;
      p.value = value;
      try {
        document.querySelectorAll(".cp-brand").forEach(function (brand) { brand.style.setProperty("--cp-progress", value.toFixed(3)); });
      } catch (e) {}
      if (p.el) p.el.style.transform = "scaleX(" + value.toFixed(3) + ")";
    }
    function cpProgressStart() {
      var p = cpProgress;
      if (!document.body) return;
      clearTimeout(p.fade);
      if (p.timer) return;   // this navigation (queued, drained or retried) is already showing
      if (document.querySelector(".cp-brand")) {
        if (p.el) { try { p.el.remove(); } catch (e) {} p.el = null; }
      } else if (!p.el || !p.el.isConnected) {
        p.el = document.createElement("div");
        p.el.id = "cp-progress";
        p.el.setAttribute("aria-hidden", "true");
        document.body.appendChild(p.el);
      }
      if (p.el) {
        p.el.classList.remove("cp-progress-done");
        p.el.classList.add("cp-progress-on");
      }
      document.documentElement.setAttribute("data-cp-progress", "on");
      cpProgressShow(0.12);
      p.timer = setInterval(function () {
        cpProgressShow(p.value + (0.92 - p.value) * 0.06);   // approaches 92% and waits there for the page
      }, 200);
    }
    function cpProgressDone() {
      var p = cpProgress;
      if (!p.timer) return;
      clearInterval(p.timer);
      p.timer = 0;
      cpProgressShow(1);
      document.documentElement.setAttribute("data-cp-progress", "done");
      if (p.el) p.el.classList.add("cp-progress-done");
      p.fade = setTimeout(function () {   // the bar has filled and faded
        if (p.el) {
          p.el.classList.remove("cp-progress-on", "cp-progress-done");
          p.el.style.transform = "scaleX(0)";
        }
        p.fade = setTimeout(function () {   // the logo's line has reached its dot and the dot has pinged
          document.documentElement.removeAttribute("data-cp-progress");
        }, 600);
      }, 600);
    }
    function cpNavBusy() {
      try { document.documentElement.setAttribute("data-cp-nav", "busy"); } catch (e) {}
      cpProgressStart();
    }
    function cpNavBusyEnd() {
      try { document.documentElement.removeAttribute("data-cp-nav"); } catch (e) {}
      cpProgressDone();
    }

    // A swap put a new page on screen (see cpPaintedEntry). A save keeps the navigation and recovery navigation
    // of the page it was opened from, as cpLastNav and cp-last-nav do.
    function cpPaintedCommit(nav, recover) {
      cpPaintedEntry = { state: history.state, href: location.href };
      if (nav) cpCommittedNav = nav;
      if (recover) cpCommittedRecover = recover;
    }
    // popstate runs after the browser has already moved the address and history.state to the target entry. A
    // replay that ends without committing leaves the old page on screen, and its forms post to an empty action,
    // which resolves against the address: put the painted entry back. pushState, never replaceState, so the
    // target entry survives for another Back/Forward.
    function cpPopReplayEnd() {
      if (!cpPopReplaying) return;
      cpPopReplaying = false; cpPopScroll = null;
      var painted = cpPaintedEntry;
      if (cpSessionRedirecting || !painted) return;
      try {
        if (painted.href === location.href &&
            JSON.stringify(painted.state && painted.state.cpNav) === JSON.stringify(history.state && history.state.cpNav)) return;
        history.pushState(painted.state, "", painted.href);
      } catch (e) {}
    }
    // One-shot markers belong to the request that set them: the chained follow-up to the request posting its
    // entry, and a refresh's history replace to its own URL. That request's queues, drains and retries pass the
    // same URL and params object and keep them; any other navigation abandons them, so a failed or overtaken
    // request can never hand them to a later, unrelated swap.
    function cpPendingEntry(url, params) {
      return !!cpPendingNav && !!cpPendingNav.after && cpPendingNav.after.url === url && cpPendingNav.after.params === params;
    }
    function cpNavClaim(url, params, contextNav) {
      if (cpPendingNav && (contextNav || !cpPendingEntry(url, params))) cpPendingNav = null;
      if (cpAutoReplaceUrl !== null && cpAutoReplaceUrl !== url) cpAutoReplaceUrl = null;
    }
    // A navigation settled without committing, so the page on screen stays. Its chained follow-up ends with it,
    // and the recovery navigation it stored before sending is put back, so browser Reload and the next sign-in
    // reopen the page on screen. A sign-in redirect keeps the attempted page: that is the one the user asked for.
    // After a deliberate sign-out there is no page to reopen.
    function cpNavFailed(url, params, recover) {
      if (cpPendingEntry(url, params)) cpPendingNav = null;
      if (cpSessionRedirecting || cpSignedOut || !recover || !cpCommittedRecover || recover === cpCommittedRecover) return;
      try {
        sessionStorage.setItem("cp-last-nav", JSON.stringify(cpCommittedRecover));
        window.postMessage({ __cpRecoverNav: cpCommittedRecover }, location.origin);
      } catch (e) {}
    }
    // A save: the named-button half of _saveNav (OK, Apply, Delete, Save, Submit, or a buttonClicked holding one),
    // or a native "Also saves current screen data" link, which submits the form with its linkForward set.
    // While one waits for CommPilot (cpWritePending), a repeated save is dropped; reads, searches and other
    // navigation still supersede it.
    function cpWriteNav(params) {
      return !!(params && (params.ok != null || params.apply != null || params.delete != null || params.save != null || params.submit != null ||
        /^(ok|apply|delete|save|submit)$/i.test(String(params.buttonClicked || "")) ||
        Array.isArray(params.__cpFormEntries) && typeof params.linkForward === "string" && params.linkForward !== ""));
    }
    function cpWriteRelease(lease) {
      if (lease && cpWritePending === lease) cpWritePending = null;
    }
    // A navigation that took the sequence, then gave up without sending anything (a drain that timed out, a
    // native script still loading, a board that did not finish), hands it back to a save or upload still waiting
    // for CommPilot when that write is the last request sent. Its own response is then still shown, page or
    // error, and the loading line stays until it arrives.
    function cpWriteHandBack() {
      var waiting = cpWritePending && cpWritePending.seq === cpSentSeq || cpUploadSentSeq === cpSentSeq;
      if (!cpSentSeq || !waiting) return false;
      cpSeq = cpSentSeq;
      return true;
    }

    cpHook = function (url, params, _retry, _contextNav) {
      if (cpBulkOwner && !cpBulkPermit) return;
      if (cpBulkOwner) _retry = true; // A bulk save is never automatically replayed.
      try {
        // Check before persisting a recovery target or changing navigation
        // state. A PBX-looking path on another host is not this PBX.
        if (isPjaxUrl(url)) {
          var addressError = cpNavigationAddressError(url);
          if (addressError) {
            cpUploadNotice(addressError);
            cpContextNavEnd(_contextNav);
            return;
          }
        }
        // A deliberate sign-out should leave the native login page visible
        // briefly after a user-initiated sign-out. One confirmed in the
        // extension's modal (cp-signing-out, intercepted below) does this only
        // once CommPilot ends the session; a failed one changes nothing.
        var _so = 0; try { _so = parseInt(sessionStorage.getItem("cp-signing-out") || "0", 10); } catch (e) {}
        var _signingOut = !!_so && Date.now() - _so < 15000;
        if (typeof url === "string" && /\/Logout(?:\/|$)/i.test(url) && !_signingOut) {
          try { sessionStorage.setItem("bwManualLogoutAt", String(Date.now())); } catch (e) {}
          try { sessionStorage.removeItem(cpRecentKey); } catch (e) {}
        }
        // SYNTHETIC-NAV GUARD: cpListSearch's client-fill harvest re-dispatches DOMContentLoaded to run a
        // page's own fill. On some pages (DeviceInventory) a DCL handler NAVIGATES (redirectPost to the
        // landing) instead of filling — 60 spin ticks fired repeated token-bearing POSTs into a 500ing
        // endpoint and KILLED the session (live 2026-07-02). Handlers run synchronously inside the
        // re-dispatch, so navs arriving inside the flag window are ours — drop them.
        if (cpDclSpin) { cpDbg("[pjax] ignoring synthetic nav during client-fill spin:", url); return; }
        // Report requests belong to the page that opened the export. Leaving it
        // (including Back) cancels that loop before a different group can load.
        if (cpUxpEl && cpUxpEl._cpCancel) cpUxpEl._cpCancel();
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
          try {
            var relativeTarget = new URL(url, _base);
            url = relativeTarget.pathname + relativeTarget.search;
          } catch (e) {}
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
        if (_signingOut && typeof url === "string" && /\/Logout(?:\/|$)/i.test(url)) {
          try { sessionStorage.removeItem("cp-signing-out"); } catch (e) {}
          // Like a newer click, the logout waits for the page's own request still on its way (a save above all):
          // it goes out after that answer, with the token it brings. The request is never sent again. One still
          // running after the limit leaves the sign-out unconfirmed; the extension's background reads (a board
          // filling in, a list collecting) do not hold it up.
          var signOutTicks = 0, signOutParams = params || {};
          (function drainBeforeSignOut() {
            if (cpInflightPosts === 0 || !cpNavPending && !cpUploadPending) { cpSignOutFetch(url, signOutParams); return; }
            if (++signOutTicks > 250) {
              console.warn('[pjax] prior CommPilot request did not finish; sign-out was not sent with a stale token');
              document.dispatchEvent(new CustomEvent("cp:logout-failed", { detail: JSON.stringify({ message: "A previous CommPilot request is still running." }) }));
              return;
            }
            setTimeout(drainBeforeSignOut, 20);
          })();
          return;
        }
        if (cpLocalListPage(url,params)) return;
        if (isPjaxUrl(url)) {
          // A double-click, Enter twice, or OK then Apply: drop the repeat before it can overtake the pending save
          // or queue behind it, where it would go out with the token that save's response rotates in.
          if (cpWritePending && !cpBulkOwner && cpWriteNav(params)) { cpDbg("[pjax] a save is already pending; repeat ignored", url); return; }
          cpNavClaim(url, params, _contextNav);
          function nativeNavigationBlocked(handedBack) {
            if (!handedBack) cpNavBusyEnd();
            cpPopReplayEnd();
            cpContextNavEnd(_contextNav);
            cpUploadNotice('A native script is still loading after its timeout. Wait for it to finish, then try again, or use your browser\'s Reload button.');
          }
          if (cpNativeScriptsLoading) {
            // Queue the user's newest click before sending another token-bearing
            // request. The outgoing page's scripts must settle while its DOM is
            // still present; removing their nodes cannot cancel the requests.
            var nativeWaitSeq = ++cpSeq;
            cpNavBusy();
            cpBulkScriptsReady.then(function () {
              if (nativeWaitSeq !== cpSeq) return;
              if (cpNativeScriptRequests.size) nativeNavigationBlocked(cpWriteHandBack());
              else cpHook(url, params, _retry, _contextNav);
            });
            return;
          }
          if (cpNativeScriptRequests.size) { nativeNavigationBlocked(); return; }
          // A failed context-changing return leaves the old workspace on screen. Restore its entity before
          // any later ordinary navigation, and never let that workspace save into the failed target's context.
          if (!_contextNav && cpRecentNeedsContext && cpRecentCurrent) {
            var recentNext = cpRecentNav({url:url,params:params});
            if (recentNext) cpRecentRestore(recentNext,cpRecentCurrent.chain);
            else cpUploadNotice('Reopen a location or reload before saving changes.');
            return;
          }
          if (_contextNav && cpContextNavActive !== _contextNav) return;
          if (!_contextNav) cpContextNavEnd(cpContextNavActive);
          cpDeviceTrack(url,params);
          cpNavBusy();
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
              if (ready) cpHook(url, params, _retry, _contextNav);
              else {
                if (!cpWriteHandBack()) cpNavBusyEnd();
                cpPopReplayEnd();
                cpContextNavEnd(_contextNav);
                cpUploadNotice("CommPilot could not finish loading this menu. Reload this page before opening an option.");
              }
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
                  cpHook(url, params, _retry, _contextNav);
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
          try { cpListFillStop(); } catch (e) {}
          try { cpSweepStop(); } catch (e) {}
          var drainSeq = ++cpTokenDrainSeq;
          // Aborting a grid sweep stops its NEXT page request, but a POST that
          // already reached CommPilot can still consume the single-use token.
          // Let that response refresh the live token before sending this nav.
          if (cpInflightPosts > 0) {
            var drainTicks = 0;
            (function drainBeforeNav() {
              if (drainSeq !== cpTokenDrainSeq || mySeq !== cpSeq) return; // a newer click or board navigation wins
              if (cpInflightPosts === 0) { cpHook(url, params, _retry, _contextNav); return; }
              if (++drainTicks > 250) {
                console.warn('[pjax] prior CommPilot request did not finish; navigation was not sent with a stale token');
                if (!cpWriteHandBack()) cpNavBusyEnd();
                cpPopReplayEnd();
                if (cpAutoReplaceUrl === url) cpAutoReplaceUrl = null;
                cpContextNavEnd(_contextNav);
                cpUploadNotice('A previous CommPilot request is still running. Please try again.');
                return;
              }
              setTimeout(drainBeforeNav, 20);
            })();
            return;
          }
          // Classify the nav so reload-recovery never remembers a FORM submit or an Add-form open: cold-replaying
          // those bounces to /Login/ on a still-alive session (the idle-reload-logout). A SUBMIT carries an action
          // button param or serialized form controls; an Add form is a deep create page. NB we deliberately
          // do NOT exclude /Modify/ broadly — SP/Group/User console drill-ins use Modify and ARE valid recover-navs.
          // See [[gotcha-idle-connection-drop-dead-click]].
          var _formNav = !!(params && Array.isArray(params.__cpFormEntries));
          var _submitNav = _formNav || !!(params && (params.ok != null || params.apply != null || params.delete != null || params.cancel != null || params.save != null || params.submit != null || params.buttonClicked != null));
          // A missing response cannot establish whether CommPilot already applied a submitted form.
          // Only ordinary navigation may use automatic network/token recovery; never resend form data.
          var cpCanRetry = !_submitNav;
          // A SAVE (OK / Apply / Delete) must never be replayed: Back or Forward onto an entry holding its POST
          // re-sent the save with the old values (found live 2026-09-28: Back after two Applies re-saved the
          // first). A save replaces the current history entry and keeps that page's own navigation instead, so
          // Back goes to where you were before the page. Searches (buttonClicked with no value) still push.
          // Direct form.submit()/requestSubmit() need not carry a named action button. Treat those as
          // writes too, except explicit search controllers and native configuration auto-forwards.
          // Tab links use cpTabNav's navigation-only parameters instead of serializing the edited form.
          var _saveNav = _formNav && !/^\/commpilot\/Common\/(?:find|findAll|page|sort)\.jsp(?:\?|$)/.test(url) && cpAutoReplaceUrl !== url ||
            !!(params && (params.ok != null || params.apply != null || params.delete != null || params.save != null || params.submit != null ||
            /^(ok|apply|delete|save|submit)$/i.test(String(params.buttonClicked || ""))));
          var _addressesUser = _saveNav && /\/User\/Addresses\/(?:index\.jsp)?(?:\?|$)/.test(url) &&
            params.extension != null && params.phoneNumber != null && params.delete == null &&
            !/^delete$/i.test(String(params.buttonClicked || "")) ? cpIdText(cpUserIdElement()) : "";
          var _nameUser = _saveNav && /\/User\/Profile\/(?:index\.jsp)?(?:\?|$)/.test(url) &&
            params.firstName != null && params.lastName != null && params.delete == null &&
            !/^delete$/i.test(String(params.buttonClicked || '')) ? cpIdText(cpUserIdElement()) : '';
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
          try { if (!_submitNav && /\/ServiceProviders\/Modify\//.test(url)) cpSpEntry = { url: url, params: params || {} }; } catch (e) {}
          // Persisted browser-reload recover-nav (stubguard cold-POST-replays this). Exclude form submits + Add opens
          // (and page.jsp/sort.jsp) so recovery falls back to the last LIST/console nav, which replays cleanly.
          // Nothing is stored once a deliberate sign-out is confirmed (cpSignedOut).
          try { if (!cpBulkOwner && !cpSignedOut && url.indexOf("/Common/page.jsp") === -1 && url.indexOf("/Common/sort.jsp") === -1 && !_submitNav && !_addForm) { var _nav = { url: url, params: params || {}, entry: (_contextNav && _contextNav.entry) || ((cpEntityEntry && cpEntityEntry.url !== url) ? cpEntityEntry : (cpIsLevelUpNav(url, params) && cpDeepEntry) || null) }; sessionStorage.setItem("cp-last-nav", JSON.stringify(_nav)); window.postMessage({ __cpRecoverNav: _nav }, location.origin); } } catch (e) {}
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var firstTok = liveTokEl ? liveTokEl.value : null;
          var cpLoader = cpNeedsFrame(url, params) ? cpFollowFrame : cpFollow;
          var cpHistoryBeforeLoad = history.length;
          cpDbg("[pjax]", cpLoader === cpFollowFrame ? "iframe-loading" : "fetching", url);
          // The page shows it is waiting for CommPilot (page-baseline.css) until this fetch settles, unless a
          // newer navigation has taken over.
          cpNavBusy();
          var cpRetryQueued = false, cpPaintedBefore = cpPaintedEntry;
          var cpNavIdle = function () {
            if (mySeq === cpSeq && !cpRetryQueued) {
              cpNavBusyEnd();
              // Successful history swaps clear this flag when they commit. A failed replay must also
              // clear it, or the next normal click replaces a Back entry instead of adding its own.
              cpPopReplayEnd();
              if (cpAutoReplaceUrl === url) cpAutoReplaceUrl = null;
              if (cpPaintedEntry === cpPaintedBefore) cpNavFailed(url, params, _nav);
              cpContextNavEnd(_contextNav);
              if (_contextNav) cpRecentRecord();
              cpStoppedBoardRetry();   // a failed option that stopped a filling board leaves that board usable
            }
          };
          var loadPage;
          if (_contextNav && (_contextNav.entries?.length || _contextNav.entry)) {
            var returnEntries = _contextNav.entries || [_contextNav.entry];
            function loadContext(index, contextToken) {
            if (index >= returnEntries.length) return cpLoader(url,params,contextToken,0);
            var returnEntry = returnEntries[index];
            var entryLoader = cpNeedsFrame(returnEntry.url,returnEntry.params) ? cpFollowFrame : cpFollow;
            return entryLoader(returnEntry.url,returnEntry.params || {},contextToken,0).then(function (res) {
              var token = res && res.doc && res.doc.getElementsByName('formtokenserial')[0];
              // Even a superseded context request spent the token. Refresh it before the newer navigation drains.
              if (token) cpWriteToken(token.value);
              if (mySeq !== cpSeq || cpContextNavActive !== _contextNav) return null;
              if (!res || res.auth === false || res.err || res.timedOut || res.navigationError) return res;
              if (!token || !res.doc.querySelector('td[width="82%"]') || res.doc.querySelector('.error, .errorMsg, .Failure'))
                return {unverifiedSave:'CommPilot could not restore this location. The current page is still open; try returning again.'};
              cpEntityEntry = {url:returnEntry.url,params:returnEntry.params || {}};
              cpDeepEntry = cpEntityEntry;
              return loadContext(index + 1,token.value);
            });
            }
            loadPage = loadContext(0,firstTok);
          } else loadPage = cpLoader(url, params, firstTok, 0);
          // A save holds the lease until its page is swapped in or its request settles (see cpWriteNav).
          var cpWriteLease = !cpBulkOwner && cpWriteNav(params) ? (cpWritePending = { url: url, seq: mySeq }) : null;
          cpSentSeq = mySeq;
          var cpResponseReceived = false;
          var cpThisNav = cpNavPending = loadPage
            .then(function (res) {
              cpResponseReceived = true;
              // A newer click supersedes the page, not the token consumed by this request. The queued
              // navigation drains this response before posting; retain its token even when its swap is dropped.
              cpWriteToken(res && res.doc && res.doc.getElementsByName('formtokenserial')[0]?.value);
              return res;
            })
            .then(async function (res) {
              if (mySeq !== cpSeq) {
                cpDbg("[pjax] superseded — dropping stale swap");
                return;
              }
              if (res && res.unverifiedSave) {
                cpUploadNotice(res.unverifiedSave);
                return;
              }
              if (res && res.navigationError) {
                cpUploadNotice(res.navigationError);
                return;
              }
              if (res && res.err >= 400) {
                // An HTTP error does not prove an expired session. Keep the page and draft intact;
                // do not harvest, replay the POST, or offer sign-in based solely on repeated errors.
                console.warn("[pjax] server " + res.err + " on " + url + " — staying on the current page (no retry)");
                // Styled in-page banner (reuses skin.css .cp-alert) instead of window.alert — the native alert
                // BLOCKS the page (and automation) and looks off-theme. Auto-dismisses; page state untouched.
                try {
                  var _bc = document.querySelector('td[width="82%"]');
                  if (_bc) {
                    _bc.querySelectorAll('.cp-alert[data-cp-nav-error]').forEach(function (alert) { alert.remove(); });
                    var _bn = document.createElement("div");
                    _bn.className = "cp-alert cp-alert-error";
                    _bn.setAttribute('data-cp-nav-error', '');
                    var errorTitle = res.err === 403 ? 'Access denied' : res.err === 404 ? 'Page not found' :
                      res.err === 429 ? 'Too many requests' : res.err >= 500 ? 'Server error' : 'Request failed';
                    var errorMessage = !cpCanRetry ? 'The save could not be confirmed. Check the saved configuration before retrying.' :
                      res.err === 403 ? 'CommPilot denied access to that page. Your current page is still open.' :
                      res.err === 404 ? 'CommPilot could not find that page. Your current page is still open.' :
                      res.err === 429 ? 'CommPilot is limiting requests. Wait before trying again; your current page is still open.' :
                      'The server could not load that page. Your current page is still open; try again in a moment.';
                    _bn.innerHTML =
                      '<div class="cp-alert-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg></div>' +
                      '<div class="cp-alert-content"><div class="cp-alert-title">' + errorTitle + '</div>' +
                      '<div class="cp-alert-body">' + errorMessage + '</div></div>' +
                      '<span class="cp-alert-chip">HTTP ' + res.err + '</span>';
                    _bc.insertBefore(_bn, _bc.firstChild);
                    setTimeout(function () { try { _bn.remove(); } catch (e) {} }, 9000);
                  } else {
                    window.alert("The server couldn't load that page (error " + res.err + ").");
                  }
                } catch (e) {}
                return;
              }
              if (res && res.timedOut) {
                // CommPilot did not answer at all. A retry now would go out beside the request it may still be
                // working on, with a token it has already replaced: stay on this page and say so.
                console.warn("[pjax] no answer from CommPilot for " + url + " — staying on the current page");
                cpUploadNotice("CommPilot did not answer. Wait a moment, then try again.");
                return;
              }
              if (!res || res.auth === false || !res.doc || !res.doc.querySelector('td[width="82%"]')) {
                if (cpBulkOwner) {
                  cpBulkOwner.failed = true;
                  cpUploadNotice('Bulk creation stopped: CommPilot did not return a usable page. Check the session before retrying.');
                  return;
                }
                if (!cpCanRetry) {
                  cpUploadNotice('The save could not be confirmed. It was not sent again. Check the saved configuration before retrying.');
                  return;
                }
                if (res && res.sessionRejected) {
                  if (!cpSessionRedirecting) {
                    cpSessionRedirecting = true;
                    location.replace('/commpilot/Login/');
                  }
                  return;
                }
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
                    cpHook(url, params, true, _contextNav);
                    return;
                  }
                  // Token did NOT rotate — the common case on a server login-BOUNCE (the rejected POST rendered
                  // no new token). Rather than fall straight to _orig (a native full-page redirectPost that FOLLOWS
                  // the server's http:// Login bounce → a visible "session timeout" logout of a possibly-still-alive
                  // session), first try to RECOVER IN PLACE: harvest a fresh app token from servlet/Login and retry
                  // the nav with it. Only if the harvest yields nothing (session genuinely dead) fall to _orig.
                  // Preserves the redirect:'manual' noise/CSP win while restoring "never hard-logout an alive session".
                  cpRetryQueued = true;
                  return cpHarvestFreshToken().then(function (tok) {
                    if (mySeq !== cpSeq) { cpDbg("[pjax] superseded — dropping stale harvest"); return; }
                    if (tok) {
                      var _toks = document.getElementsByName("formtokenserial");
                      for (var _i = 0; _i < _toks.length; _i++) _toks[_i].value = tok;
                      console.warn("[pjax] follow unusable, token not rotated — harvested a fresh token, re-attempting nav in place");
                      cpHook(url, params, true, _contextNav);
                    } else {
                      if (!cpSessionRedirecting) {
                        cpSessionRedirecting = true;
                        console.warn("[pjax] no content cell after follow + harvest empty — opening sign-in");
                        location.replace("/commpilot/Login/");
                      }
                    }
                  }).catch(function (error) {
                    if (mySeq !== cpSeq) return;
                    cpRetryQueued = false;
                    cpUploadNotice(error.message);
                  });
                }
                if (res && res.auth === false && !cpSessionRedirecting) {
                  cpSessionRedirecting = true;
                  console.warn("[pjax] sign-in response after retry — opening sign-in");
                  location.replace("/commpilot/Login/");
                } else {
                  cpUploadNotice('CommPilot returned an incomplete page. Your current page is still open; try again in a moment.');
                }
                return;
              }
              // A script already requested by the previous native page can
              // still execute after its node is removed. Finish that page's
              // initialization before installing the destination's globals.
              await cpBulkScriptsReady;
              if (mySeq !== cpSeq) return;
              var doc = res.doc;
              // Voice Management's Advanced link saves General, then forwards
              // to General/Nested/index.jsp. That page has its own relative
              // validator and form action; using General's URL loads the wrong
              // password handlers and submits the mailbox to the wrong endpoint.
              var cpVoiceForwarded = false;
              if (/^\/commpilot\/User\/VM\//.test(url) && res.responseUrl) {
                var voiceDestination = new URL(res.responseUrl, location.href);
                if (voiceDestination.origin === location.origin &&
                    /^\/commpilot\/User\/VM\//.test(voiceDestination.pathname) &&
                    voiceDestination.pathname + voiceDestination.search !== url) {
                  url = voiceDestination.pathname + voiceDestination.search;
                  params = {};
                  cpVoiceForwarded = true;
                  cpLastNav = {url:url,params:{}};
                }
              }
              // Schedule Event Add/Modify OK saves the event, then CommPilot's stub returns to the hosting
              // Schedule Modify page (see cpFollow). That page owns the address, Back entry and F5; otherwise its
              // relative Add and its self-posting OK/Apply resolve against the Event controller. It keeps only the
              // stub's own read-only navigation, never the submitted event.
              var cpScheduleReturned = null;
              if (_submitNav && res.responseUrl && res.responseParams &&
                  /^\/commpilot\/(?:ServiceProvider|Group|User)\/Schedules\/Events\/(?:Add|Modify)\/(?:index\.jsp)?$/.test(url)) {
                var scheduleDestination = new URL(res.responseUrl, location.href);
                if (scheduleDestination.origin === location.origin &&
                    /^\/commpilot\/(?:ServiceProvider|Group|User)\/Schedules\/Modify\/(?:index\.jsp)?$/.test(scheduleDestination.pathname))
                  cpScheduleReturned = cpHistoryReplayNav({ url: scheduleDestination.pathname + scheduleDestination.search, params: res.responseParams });
                if (cpScheduleReturned) {
                  url = cpScheduleReturned.url;
                  params = cpScheduleReturned.params;
                  cpLastNav = cpScheduleReturned;
                }
              }
              // A context redirect must never masquerade as the requested appearance. Keep the device editor
              // on screen if CommPilot returns a user home/list instead of the exact SCA Modify page.
              if (_contextNav && /\/User\/SCAP\/Modify\//.test(url) &&
                  !/^Shared Call Appearance Modify$/i.test((doc.querySelector('td.screenName')?.textContent || doc.title || '').trim())) {
                cpWriteToken(doc.getElementsByName('formtokenserial')[0]?.value);
                cpUploadNotice('CommPilot did not return Shared Call Appearance Modify. The current page is still open; try returning again.');
                return;
              }
              if (_addressesUser) cpMarkSavedAddresses(doc, params, _addressesUser);
              if (_nameUser) cpMarkSavedName(doc,params,_nameUser);

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
              if (_saveNav && cpDeviceProfileBase(url) &&
                  /^Identity\/Device Profiles$/i.test((doc.querySelector('td.screenName')?.textContent || doc.title || '').trim()) &&
                  !doc.querySelector('.error, .errorMsg, .Failure') &&
                  cpDeviceSaved(params.ok != null || /^ok$/i.test(params.buttonClicked || '') ? 'ok' :
                    params.apply != null || /^apply$/i.test(params.buttonClicked || '') ? 'apply' : '')) return;

              // Swap content cell
              var fetched = doc.querySelector('td[width="82%"]');
              var liveCell = document.querySelector('td[width="82%"]');
              if (!fetched || !liveCell) {
                console.warn("[pjax] content cell not found", !!fetched, !!liveCell);
                return;
              }
              cpRecentBlock(false);
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
                    var _mt = cpGridActionTarget(_ml[0], doc);
                    if (_mt) {
                      var _mu = _mt.url;
                      if (_mu.charAt(0) !== "/") _mu = "/commpilot/Operator/System/DeviceType/" + _mu;
                      if (_mu.indexOf("/DeviceType/Profile/") !== -1) {
                        cpDbg("[pjax] single-item drill skip ->", _mu);
                        cpHook(_mu, _mt.params);
                        return;
                      }
                    }
                  }
                }
              } catch (e) {}
              // A failed native initializer disables only that page's controls.
              // A later reload or sidebar navigation must not inherit the lock.
              if (liveCell.__cpNativeWasInert !== undefined) {
                liveCell.inert = liveCell.__cpNativeWasInert;
                delete liveCell.__cpNativeWasInert;
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
                  // A save can also replace the sidebar. Its submitted controls must never become
                  // replayable entity ancestry on the next navigation; retain the last known entry.
                  if (!_submitNav) {
                    cpEntityEntry = _contextNav && _contextNav.entry ?
                      {url:_contextNav.entry.url,params:_contextNav.entry.params || {}} :
                      { url: url, params: params || {} };   // this nav set the server's target context
                    if (url.indexOf("/Common/folder_contents.jsp") === -1) cpDeepEntry = cpEntityEntry;
                  }
                }
              } catch (e) { console.warn("[pjax] sidebar swap", e); cpLiveNav = null; }

              // A restored entity's own menu is opened through its Modify entry. The hidden context chain
              // ends at the PARENT in that case; the target POST, not that parent, becomes the board's entry.
              // Keep this outside the sidebar-change branch: two users can have identical sidebar folders.
              if (!_submitNav && cpNeedsFrame(url,params) && url.indexOf('/Common/folder_contents.jsp') === -1) {
                cpEntityEntry = {url:url,params:params || {}};
                cpDeepEntry = cpEntityEntry;
              }

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
              var cpPrevNav = !cpVoiceForwarded && history.state && history.state.cpNav;
              var cpState = cpScheduleReturned ? { cpNav: cpScheduleReturned } :
                _saveNav ? { cpNav: cpPrevNav && cpPrevNav.url ? cpPrevNav : { url: url, params: {} } } :
                { cpNav: { url: url, params: params || {},
                  entry: (cpEntityEntry && cpEntityEntry.url !== url) ?
                    { url: cpEntityEntry.url, params: cpEntityEntry.params || {} } : null } };
              var cpHistoryMode = cpBulkOwner || _saveNav || cpPopReplaying || cpAutoReplaceUrl === url ||
                (cpLoader === cpFollowFrame && history.length > cpHistoryBeforeLoad) ? "replace" : "push";
              if (cpDeviceProfileOrigin && cpDeviceProfileBase(cpDeviceProfilePage(url,params)) === cpDeviceProfileOrigin.base)
                cpState.cpDeviceOrigin = cpDeviceProfileOrigin;
              else if (cpDeviceProfileOrigin && !cpPendingNav) {
                cpDeviceProfileOrigin = null;
                try { sessionStorage.removeItem('cp-device-origin'); } catch (e) {}
              }
              if (cpAutoReplaceUrl === url) cpAutoReplaceUrl = null;
              var cpHistoryCommitted = false;
              try {
                history[cpHistoryMode + "State"](cpState, "", url);
                cpHistoryCommitted = true;
                cpPopReplaying = false;
              } catch (e) {}
              // A save keeps the page it was sent from, except one whose response is another page's own navigation
              // (the Voice Management forward, the schedule return), which F5 then refreshes.
              cpPaintedCommit(cpScheduleReturned || (_submitNav && !cpVoiceForwarded ? null : { url: url, params: params || {} }), _nav);
              cpWriteRelease(cpWriteLease);   // the form it was sent from has been replaced
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
              // Voice Management's save-and-forward links need the native
              // head dependencies and page validator, not just body wiring.
              // Ordinary pages also need parser order when body wiring depends
              // on an external script. They retain their existing head globals.
              var nativeVoiceForm = /^\/commpilot\/User\/VM\//i.test(url);
              var replayNativeHead = !!cpBulkOwner || nativeVoiceForm;
              var nativeContainers = [liveCell, cpLiveNav, cpLiveHeader].filter(Boolean);
              var bodyScripts = replayNativeHead ? [] : nativeContainers.flatMap(function (container) {
                return [].slice.call(container.querySelectorAll('script'));
              });
              var hasBodyDependency = bodyScripts.some(function (script) {
                return script.hasAttribute('src') && cpNativeScriptKind(script) === 'classic';
              });
              // The ordered native loader handles classic CommPilot scripts.
              // Preserve existing module execution on pages using that dialect.
              var hasBodyModule = bodyScripts.some(function (script) {
                return cpNativeScriptKind(script) === 'module';
              });
              var orderedNativeScripts = replayNativeHead || (hasBodyDependency && !hasBodyModule);
              var bulkDclFns = orderedNativeScripts ? [] : null, bulkLoadFns = [];
              var origAdd = document.addEventListener;
              document.addEventListener = function (type, fn, opts) {
                if (type === "DOMContentLoaded" && typeof fn === "function") {
                  try { window.__cpDclFns.push(fn); } catch (e) {}
                  if (bulkDclFns) { bulkDclFns.push({fn: fn, source: document.currentScript?.getAttribute('data-cp-native-source') || 'page startup'}); return; }
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
                  if (bulkDclFns) { bulkLoadFns.push({fn: fn, source: document.currentScript?.getAttribute('data-cp-native-source') || 'page startup'}); return; }
                  Promise.resolve().then(function () {
                    try { fn.call(window, new Event("load")); } catch (e) { cpWarnCo("loadshim|" + String((e && e.message) || e), "[pjax] load shim err: " + String((e && e.message) || e)); }
                  });
                  return;
                }
                return origWinAdd.call(this, type, fn, opts);
              };
              var n = 0;
              var externalScripts = [];
              var restoreDcl = function () {
                if (cpExternalDclRestore !== restoreDcl) return;
                document.addEventListener = origAdd;
                window.addEventListener = origWinAdd;
                cpExternalDclRestore = null;
              };
              cpExternalDclRestore = restoreDcl;
              if (orderedNativeScripts) {
                var orderedContainers = [liveCell];
                if (cpLiveNav) orderedContainers.push(cpLiveNav);
                if (cpLiveHeader) orderedContainers.push(cpLiveHeader);
                var nativeFormWasInert = liveCell.inert;
                var holdNativeControls = !cpBulkOwner;
                if (holdNativeControls) {
                  liveCell.__cpNativeWasInert = nativeFormWasInert;
                  liveCell.inert = true;
                }
                cpReexecutingScripts = true;
                cpNativeScriptsLoading = true;
                // Resolve with an error value so a load rejection cannot become
                // an unhandled promise before the transport reaches its await.
                cpBulkScriptsReady = cpNativePageScripts(doc, url, orderedContainers, true,
                  nativeVoiceForm ? function () { return mySeq === cpSeq; } : null, replayNativeHead).then(function () {
                  if (nativeVoiceForm && mySeq !== cpSeq) return null;
                  // Match native page startup: all scripts, then DCL, then load.
                  // A thrown initializer must block the bulk step too.
                  for (var stage of [{handlers: bulkDclFns, target: document, type: 'DOMContentLoaded'}, {handlers: bulkLoadFns, target: window, type: 'load'}]) {
                    for (var handler of stage.handlers) {
                      try { handler.fn.call(stage.target, new Event(stage.type)); }
                      catch (error) { throw new Error('Native ' + stage.type + ' handler failed (' + handler.source + '): ' + error.message); }
                    }
                  }
                  return null;
                }).catch(function (error) {
                  // This can also be the response AFTER a successful save; do
                  // not claim that previous write was never sent.
                  return new Error((error?.message || 'Native page initialization failed.') +
                    (cpBulkOwner ? ' Retry will check the saved setup before continuing.' : ' Refresh the page to reload its native controls.'));
                }).finally(function () {
                  cpNativeScriptsLoading = false;
                  cpReexecutingScripts = false;
                  restoreDcl();
                  if (window.redirectPost !== cpHook) { _orig = window.redirectPost; window.redirectPost = cpHook; }
                });
                // Keep native DOM intact until its event handlers are attached;
                // reskin can otherwise move/remove nodes while scripts load.
                var nativeScriptFailure = await cpBulkScriptsReady;
                if (nativeVoiceForm && mySeq !== cpSeq) return;
                if (nativeScriptFailure) {
                  if (!cpBulkOwner) {
                    var nativeNotice = document.createElement('div');
                    nativeNotice.className = 'cp-alert cp-alert-error';
                    nativeNotice.setAttribute('role', 'alert');
                    nativeNotice.innerHTML = '<div class="cp-alert-content"><div class="cp-alert-title"></div><div class="cp-alert-body"></div></div>';
                    nativeNotice.querySelector('.cp-alert-title').textContent = nativeVoiceForm ? 'Voice Management could not initialize' : 'Native page could not initialize';
                    nativeNotice.querySelector('.cp-alert-body').textContent = nativeScriptFailure.message;
                    liveCell.prepend(nativeNotice);
                  }
                  return;
                }
                if (holdNativeControls) {
                  liveCell.inert = nativeFormWasInert;
                  delete liveCell.__cpNativeWasInert;
                }
              } else {
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
              if (externalScripts.length) {
                var pendingScripts = externalScripts.filter(function (script) { return !script._cpLoaded; });
                if (pendingScripts.length) {
                  cpNativeScriptsLoading = true;
                  cpBulkScriptsReady = new Promise(function (resolve) {
                    var settled = false;
                    var finish = function (error) {
                      if (settled) return;
                      settled = true;
                      clearTimeout(scriptDeadline);
                      cpNativeScriptsLoading = false;
                      restoreDcl();
                      resolve(error || null);
                    };
                    // Removing a script does not cancel its download. Retain
                    // the actual requests after timeout so late execution cannot
                    // overwrite the next page's native functions.
                    var scriptDeadline = setTimeout(function () {
                      finish(new Error('Native page script timed out.'));
                    }, 15000);
                    pendingScripts.forEach(function (script) {
                      cpNativeScriptRequests.add(script);
                      var scriptDone = function () {
                        script.removeEventListener("load", scriptDone);
                        script.removeEventListener("error", scriptDone);
                        cpNativeScriptRequests.delete(script);
                        pendingScripts = pendingScripts.filter(function (item) { return item !== script; });
                        if (!pendingScripts.length) finish();
                      };
                      script.addEventListener("load", scriptDone);
                      script.addEventListener("error", scriptDone);
                    });
                  });
                } else restoreDcl();
              } else restoreDcl();
              }
              if (window.redirectPost !== cpHook) { _orig = window.redirectPost; window.redirectPost = cpHook; }
              cpDbg("[pjax] re-executed", n, "scripts");
              // Stamp the NAV TARGET on <html> BEFORE the reskin: cp:reskin handlers run before the address-bar
              // history update, so location.pathname is still the PREVIOUS page inside them. skin.js's
              // pathname-keyed form dispatch (the notification-email family) reads this attribute first.
              try { document.documentElement.setAttribute("data-cp-path", url); } catch (e) {}
              // Successful swap: the session is alive — reset the dead-session streak, stamp the
              // idle watchdog, and clear a stale idle-warning banner.
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
                if (_submitNav && !cpScheduleReturned && cpFormOrigin && canonical === url &&
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
                cpPaintedCommit();
              } catch (e) {}
              // Chained follow-up (entity re-entry → target page): fire the pending nav now that this swap
              // (the entry) has committed. See cpPendingNav/cpEntityEntry.
              try {
                if (!cpPendingNav) {
                  // Context restoration finishes after this callback. Record only the final page, after
                  // clearing its navigation transaction, and never one of the hidden ancestry requests.
                  if (_contextNav?.recent) cpContextNavEnd(_contextNav);
                  cpRecentRecord();
                }
                if (cpPendingNav) { var _pn = cpPendingEntry(url, params) && cpPendingNav; cpPendingNav = null;
                  if (_pn && _pn.replace) cpAutoReplaceUrl = _pn.url;
                  if (_pn) setTimeout(function () { cpHook(_pn.url, _pn.params || {}); }, 0); }
              } catch (e) {}
            })
            .catch(function (e) {
              // Fetch can fail after the server applied a request but before its response arrived.
              // Never infer that a save was not processed. Also distinguish transport errors from
              // TypeErrors thrown while applying a response: replaying a UI exception cannot fix it.
              var _msg = String((e && e.message) || e || "");
              var isNetErr = !!e && (e.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(_msg));
              if (mySeq !== cpSeq) return;
              if (!cpCanRetry) {
                cpUploadNotice('The save could not be confirmed. It was not sent again. Check the saved configuration before retrying.');
              } else if (e && e.name === 'TimeoutError') {
                cpUploadNotice('CommPilot did not respond within 90 seconds. Your current page is still open. The request was not sent again.');
              } else if (isNetErr && !cpResponseReceived && !_retry) {
                cpRetryQueued = true;
                console.warn("[pjax] fetch network error (dropped idle connection?) — retrying nav once on a fresh connection");
                setTimeout(function () { try { if (mySeq === cpSeq) cpHook(url, params, true, _contextNav); } catch (e2) {} }, 200);
                return;
              } else if (isNetErr && !cpResponseReceived) {
                cpUploadNotice('CommPilot could not load this page because the connection failed. Your current page is still open; try again in a moment.');
              }
              cpWarnCo("failed|" + url + "|" + _msg, "[pjax] fetch FAILED " + _msg + " (" + url + ")");
            });
          cpThisNav.then(function () { if (cpNavPending === cpThisNav) cpNavPending = null; cpWriteRelease(cpWriteLease); });
          cpThisNav.then(cpNavIdle, cpNavIdle);

          return; // do NOT call _orig — no navigation for menu navs
        }
      } catch (e) {}
      return _orig.apply(this, arguments);
    };

    window.redirectPost = cpHook;

    // Native-form automation owns the same transport as normal navigation. It waits for old reads,
    // keeps the latest token, and never retries an uncertain write. UI and credentials stay out of
    // navigation history; the caller must inspect the saved native pages before marking a step done.
    window.cpAcquireUserBulk = async function () {
      if (cpBulkOwner) throw new Error('Another bulk creation is already open.');
      var owner = cpBulkOwner = { failed: false }, executing = false;
      function rememberLocation() { owner.url = location.href; owner.state = history.state; }
      rememberLocation();
      function holdBrowserBack(event) {
        event.stopImmediatePropagation();
        // A browser Back cannot change the server entity underneath an in-progress native form.
        history.pushState(owner.state, '', owner.url);
      }
      window.addEventListener('popstate', holdBrowserBack, true);
      cpSectionAborted = true; cpSectionQueue = [];
      if (cpAggActive) cpAggEnd();
      if (cpPeekObserver) { cpPeekObserver.disconnect(); cpPeekObserver = null; }
      if (cpGridState && cpGridState._searchAbort) cpGridState._searchAbort.abort();
      if (cpGridState && cpGridState._sweepAbort) cpGridState._sweepAbort.abort();
      function owned() { if (cpBulkOwner !== owner) throw new Error('The bulk session is closed.'); }
      async function idle(waitForScripts) {
        var started = Date.now();
        while (cpInflightPosts || cpNavPending || cpUploadActive) {
          if (Date.now() - started > 30000) throw new Error('A CommPilot request is still running. Wait for it to finish.');
          await new Promise(function (resolve) { setTimeout(resolve, 25); });
        }
        if (waitForScripts !== false) {
          await cpBulkScriptsReady;
          if (cpNativeScriptRequests.size)
            throw new Error('A native script is still loading. Wait for it to finish or reload the page before opening a bulk session.');
        }
      }
      try { await Promise.all([cpListFillStop(), cpSweepStop()]); await idle(); }
      catch (error) { window.removeEventListener('popstate', holdBrowserBack, true); cpBulkOwner = null; throw error; }
      async function execute(action) {
        owned();
        if (owner.failed) throw new Error('Retry this batch to check the CommPilot session before resuming.');
        if (executing) throw new Error('Another bulk step is still running.');
        executing = true;
        var diagnostic = {phase:'waiting for session',actionDispatched:false,pageSwapped:false,navigationStarted:false,uploadStarted:false,requests:[]};
        try {
          await idle();
          owner.diagnostic = diagnostic;
          var swapped = false, onSwap = function () { swapped = true; diagnostic.pageSwapped = true; };
          document.addEventListener('cp:reskin', onSwap);
          try {
            cpBulkScriptsReady = Promise.resolve(null);
            cpBulkPermit = true;
            diagnostic.phase = 'native action and validation';
            try { action(); diagnostic.actionDispatched = true; } finally { cpBulkPermit = false; }
            var nav = cpNavPending, upload = cpUploadPending;
            diagnostic.navigationStarted = !!nav; diagnostic.uploadStarted = !!upload;
            if (upload) {
              // Device Profile Modify posts multipart data to its native servlet,
              // then opens the returned page. Own that entire save, not just the
              // later navigation. Never send it again after a missing response.
              diagnostic.phase = 'multipart response';
              var uploadResult = await upload;
              if (uploadResult) { owner.failed = true; throw new Error(uploadResult); }
              nav = cpNavPending;
            }
            if (!nav && !swapped) throw new Error('The native form did not navigate. Check its required fields.');
            diagnostic.phase = 'navigation response';
            if (nav) await nav;
            await idle(false);
            // A swap is not ready to edit/save until all native dependencies and
            // page handlers have executed. A timeout is a failure, never readiness.
            diagnostic.phase = 'native script initialization';
            var scriptFailure = await cpBulkScriptsReady;
            if (scriptFailure) { owner.failed = true; throw scriptFailure; }
            diagnostic.phase = 'page confirmation';
            if (!swapped) { owner.failed = true; throw new Error('The save or navigation could not be confirmed. It was not replayed. Retry will first check the session and existing setup.'); }
            rememberLocation();
          } finally { document.removeEventListener('cp:reskin', onSwap); }
        } catch (error) {
          // Only operation state: never copy URL queries, request bodies or tokens.
          error.bulkDiagnostic = diagnostic;
          throw error;
        } finally { owner.diagnostic = null; executing = false; }
      }
      return {
        get needsRecovery() { return owner.failed; },
        recover: async function () {
          owned(); if (executing) throw new Error('Another bulk step is still running.');
          executing = true;
          try {
            await idle();
            var token = await cpHarvestFreshToken();
            if (!token) throw new Error('Sign in to CommPilot in another tab, then retry this batch. Completed steps are preserved here.');
            cpWriteToken(token); owner.failed = false;
          } finally { executing = false; }
        },
        navigate: function (url, params) {
          var target = new URL(url, location.href);
          if (target.origin !== location.origin || !isPjaxUrl(target.pathname + target.search))
            return Promise.reject(new Error('This native page cannot be opened safely inside the bulk session.'));
          return execute(function () { cpHook(target.pathname + target.search, params || {}, true); });
        },
        action: execute,
        search: async function (criteria, options) {
          owned(); if (executing) throw new Error('Another bulk step is still running.');
          executing = true;
          try { await idle(); return await cpListSearchRun(criteria, options || {}); }
          catch (error) { owner.failed = true; throw error; }
          finally { executing = false; }
        },
        release: function () {
          owned(); if (executing || cpInflightPosts || cpNavPending) throw new Error('Wait for the current step before closing.');
          window.removeEventListener('popstate', holdBrowserBack, true);
          cpBulkOwner = null;
        }
      };
    };


    // Known multipart servlets accept POSTs and answer with a token-bearing
    // redirectPost stub. Keep the file POST in the current document, then let
    // cpHook follow that stub and repaint the resulting CommPilot page.
    // cpUploadSentSeq: the sequence of a sent upload still waiting for its response (see cpWriteHandBack).
    var cpUploadActive = false, cpUploadPending = null, cpUploadSentSeq = 0;
    window.cpHasPendingNativeRequest = function () {
      return !!(cpInflightPosts || cpNavPending || cpUploadPending);
    };
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
      if (cpBulkOwner && !cpBulkPermit) return true;
      if (cpUploadActive) return true;
      cpUploadActive = true;
      var uploadOwner = cpBulkOwner, finishUpload;
      var pendingUpload = cpUploadPending = new Promise(function (resolve) { finishUpload = resolve; });
      function navigateUploadResult(callback) {
        if (uploadOwner && cpBulkOwner !== uploadOwner) {
          release('The save was sent, but its owning session ended. Check the saved configuration before retrying.');
          return false;
        }
        var permit = cpBulkPermit;
        if (uploadOwner) cpBulkPermit = true;
        try { return callback(); } finally { cpBulkPermit = permit; }
      }
      if (cpAggActive) { cpSectionAborted = true; cpAggEnd(); }
      try { if (cpGridState && cpGridState._searchAbort) cpGridState._searchAbort.abort(); } catch (e) {}
      try { if (cpGridState && cpGridState._sweepAbort) cpGridState._sweepAbort.abort(); } catch (e) {}
      try { cpSweepStop(); } catch (e) {}
      var uploadSeq = ++cpSeq; // discard a late navigation response instead of overwriting the upload result
      cpNavBusy();   // until the upload settles here, or its result page's own navigation takes over
      var body = new FormData(form);
      if (submitter && submitter.name) body.append(submitter.name, submitter.value || '');
      var deviceAction = action.pathname === '/commpilot/servlet/DeviceInventoryProvisionServlet' ?
        String(submitter && submitter.name || body.get('buttonClicked') || '').toLowerCase() : '';
      var buttons = [].slice.call(form.querySelectorAll('[type="submit"]')).map(function (button) {
        return { element: button, disabled: button.disabled };
      });
      buttons.forEach(function (button) { button.element.disabled = true; });
      form.setAttribute('aria-busy', 'true');
      var finished = false;
      var uploadController = new AbortController(), uploadExpired = false;
      // Manual file uploads may be larger than bulk credential saves. Give them five minutes,
      // but never leave the form and single-use-token lock held indefinitely after a lost response.
      var uploadTimer = setTimeout(function () {
        uploadExpired = true;
        uploadController.abort();
        release('The native save response timed out. Check the saved configuration before retrying.');
      },uploadOwner ? 45000 : 300000);
      function release(message) {
        if (finished) return;
        finished = true; cpUploadActive = false;
        if (uploadTimer) clearTimeout(uploadTimer);
        if (cpUploadPending === pendingUpload) cpUploadPending = null;
        if (cpUploadSentSeq === uploadSeq) cpUploadSentSeq = 0;
        if (cpSeq === uploadSeq) cpNavBusyEnd();
        buttons.forEach(function (button) { button.element.disabled = button.disabled; });
        form.removeAttribute('aria-busy');
        if (message) cpUploadNotice(message);
        finishUpload(message || null);
      }
      var waited = 0;
      function sendWhenReady() {
        if (finished) return;
        if (cpSeq !== uploadSeq || !form.isConnected) { release(uploadOwner ? 'The native save was interrupted. Check before retrying.' : null); return; }
        if (cpInflightPosts > 0) {
          if (waited++ < 250) { setTimeout(sendWhenReady, 20); return; }
          cpWriteHandBack();
          release('Another page request is still running. Please try the upload again.');
          return;
        }
        var liveToken = document.getElementsByName('formtokenserial')[0];
        if (liveToken) body.set('formtokenserial', liveToken.value);
        cpInflightPosts++;
        cpSentSeq = cpUploadSentSeq = uploadSeq;
        var requestHeld = true;
        function finishRequest() {
          if (!requestHeld) return;
          requestHeld = false;
          cpInflightPosts = Math.max(0, cpInflightPosts - 1);
        }
        var requestDiagnostic = cpBulkRequestDiagnostic(action.href);
        fetch(action.href, { method: 'POST', body: body, credentials: 'same-origin', redirect: 'manual', signal:uploadController?.signal })
          .then(function (response) {
            if (requestDiagnostic) { requestDiagnostic.status = response.status; requestDiagnostic.responseType = response.type; }
            if (response.status >= 500) {
              release('The server could not process the upload. No automatic retry was sent.');
              return null;
            }
            if (response.status === 401) {
              release('The upload could not continue because the session ended. Please sign in again.');
              return null;
            }
            if (response.type === 'opaqueredirect' || response.status === 0 || response.status >= 300) {
              release('The upload response could not be confirmed. Check the result before trying again.');
              return null;
            }
            return response.text();
          })
          .then(function (html) {
            if (!uploadOwner && uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null; }
            // The servlet response (including its new token) has arrived. Its
            // return navigation must not queue behind this already-finished
            // request, then lose the bulk owner's one-action permit.
            finishRequest();
            if (html == null || finished) return;
            var doc = new DOMParser().parseFromString(html, 'text/html');
            // An upload consumes the live token even if the user leaves before
            // its reply or the reply is a validation page without a redirect.
            // Preserve its replacement before dropping the obsolete result.
            cpWriteToken(doc.getElementsByName('formtokenserial')[0]?.value);
            if (cpSeq !== uploadSeq) { release(uploadOwner ? 'The native save response was superseded. Check before retrying.' : null); return; }
            var stub = cpExtractStub(doc);
            if (!stub || !stub.target || !isPjaxUrl(stub.target)) {
              release('The upload was sent, but its result could not be displayed. Reload to inspect it.');
              return;
            }
            if (/^\/commpilot\/(?:Group|ServiceProvider|Operator\/System)\/DeviceInventory\/(?:index\.jsp)?$/.test(stub.target) &&
                !doc.querySelector('.error, .errorMsg, .Failure') &&
                navigateUploadResult(function () { return cpDeviceSaved(deviceAction); })) {
              if (cpContextNavActive) {
                // Release on this return's completion/failure, rather than an unrelated reskin or a fixed
                // 15-second timer while a slow context request is still working. The save itself is finished.
                cpContextNavActive.onSettled = function () { release(); };
                return;
              }
              document.addEventListener('cp:reskin', function () { release(); }, {once:true});
              setTimeout(function () {
                if (!finished) release('The save was sent, but its return page did not appear. Check before trying again.');
              },15000);
              return;
            }
            document.addEventListener('cp:reskin', function () { release(); }, { once: true });
            navigateUploadResult(function () { cpHook(stub.target, stub.data || {}); });
            setTimeout(function () {
              if (!finished) release('The upload was sent, but its result did not appear. Check before trying again.');
            }, 15000);
          })
          .catch(function (error) {
            if (requestDiagnostic && requestDiagnostic.status === null) requestDiagnostic.failure = uploadExpired ? 'Request timed out' : 'Network request failed';
            console.warn('[pjax] upload request failed:', error);
            release('The upload response was lost. Check the result before trying again.');
          })
          .then(finishRequest, finishRequest);
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
        if (cpRecentNeedsContext || cpContextNavActive && cpDeviceProfilePage(location.pathname,history.state?.cpNav?.params)) {
          e.preventDefault(); e.stopImmediatePropagation();
          return;
        }
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
        if (cpRecentNeedsContext && e.target.closest?.('input[name="ok"], button[name="ok"], input[name="apply"], button[name="apply"], input[name="delete"], button[name="delete"]')) {
          e.preventDefault(); e.stopImmediatePropagation(); return;
        }
        var devicePage = cpDeviceProfilePage(_p,history.state?.cpNav?.params);
        if (devicePage && cpContextNavActive &&
            e.target.closest?.('input[name="ok"], button[name="ok"], input[name="apply"], button[name="apply"], input[name="cancel"], button[name="cancel"]')) {
          e.preventDefault(); e.stopImmediatePropagation();
          return;
        }
        if (devicePage && /^[A-Za-z0-9_-]+\/(?:index\.jsp)?$/.test(devicePage.slice(cpDeviceProfileBase(devicePage).length)) && cpDeviceProfileOrigin &&
            e.target.closest?.('input[name="cancel"], button[name="cancel"]')) {
          e.preventDefault(); e.stopImmediatePropagation();
          cpDeviceReturn();
          return;
        }
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

    // Assign Domains: the 4 move buttons (PICKLIST_*Domain) are DCL-wired
    // (getElementById(button_<uuid>).addEventListener → addDomain/removeDomain/… → form.submit()),
    // which BOTH dies after an in-shell swap AND native-POSTs on a full load. Re-wire them here:
    // replicate the Scripts/domains.js protocol (toAdd/toRemove = comma-joined selected option
    // VALUES; action = add/remove; assigned values ending "*" are the default domain and can't be
    // removed) and requestSubmit() so the submit interceptor above replays it in-shell. Capturing +
    // stopImmediatePropagation pre-empts the legacy listener when it IS alive (full load) so the
    // move can't double-submit. Other pick lists (memberList, subscribedList, service packs, number
    // prefixes) post other lists and fields: their clicks stay with CommPilot's own handler, whose
    // form.submit() the bridge above replays in-shell.
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
        if (!/^PICKLIST_(?:add|remove|selectAll|removeAll)Domain$/.test(b.id || "")) return;
        var list = isAdd ? form.elements.availableList : form.elements.assignedList;
        if (!list) return;
        e.preventDefault(); e.stopImmediatePropagation();
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
      // Bulk tools own the current native form/token until their dialog or transport lease ends.
      // An ignored shortcut must not debounce a real refresh after that ownership is released.
      if (cpBulkOwner || document.querySelector('.cp-bulk-overlay')) return;
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
      try { cpListFillStop(); } catch (e2) {}
      try { cpSweepStop(); } catch (e2) {}
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
      // Even off the grid, a token-bearing POST may be mid-rotation (a console/aggregation fetch). DRAIN all
      // in-flight token-POSTs to 0 (max ~1.6s) before replaying, so the reload's POST can't race a fetch over the
      // single-use token. This counts an aborted-but-still-resolving prior search too — which the old
      // single-_searchPromise wait missed (abort stops the loop, not the in-flight fetch).
      var reloadSeq = cpSeq;
      var _navGo = function () {
        if (reloadSeq !== cpSeq) return; // A newer click owns navigation while refresh drains.
        // Refresh the page on screen, not the latest request (cpLastNav), which may have failed or still be
        // loading. A Back/Forward replay has already moved the address to its target, so that one is refreshed.
        // Choose it now, after the drain: a pending click can commit, or a Back replay fail, while F5 waits.
        // Fall back to the persisted cp-last-nav (sessionStorage) before the reseller-home default: after a
        // reload-button recovery the page is fresh, so the in-memory cpLastNav is null even though we ARE deep
        // in an SP/group/user — without this, F5 right after the reload button jumps all the way to reseller.
        var nav = cpPopReplaying ? cpLastNav : cpCommittedNav;
        if (!nav) { try { nav = JSON.parse(sessionStorage.getItem("cp-last-nav") || "null"); } catch (e) {} }
        if (!nav || !nav.url) nav = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
        nav = cpHistoryReplayNav(nav);
        if (!nav) {
          cpUploadNotice('This saved reload entry cannot be reopened safely. Open the page from its menu.');
          return;
        }
        cpDbg("[pjax] reload intercepted → replay", nav.url);
        try {
          cpAutoReplaceUrl = nav.url; // Refresh replaces the current entry, like native Reload.
          window.redirectPost(nav.url, nav.params || {});
        } catch (err) { console.warn("[pjax] reload replay failed", err); }
      };
      var _t0 = Date.now();
      (function _drain() {
        if (reloadSeq !== cpSeq) return;
        if (cpInflightPosts <= 0 || Date.now() - _t0 > 1600) { _navGo(); return; }
        setTimeout(_drain, 40);
      })();
    }, true);

    window.addEventListener("popstate", function (e) {
      try {
        // A bulk dialog's own listener restores its held history entry. Do not
        // start a group-changing POST before that listener can run.
        if (cpBulkOwner || document.querySelector('.cp-bulk-overlay')) return;
        var nav = e.state && e.state.cpNav;
        if ((!nav || !nav.url) && cpSearchLandingNav &&
            location.pathname === cpSearchLanding &&
            document.documentElement.getAttribute("data-cp-path") !== location.pathname) {
          nav = cpSearchLandingNav;
          cpDbg("[pjax] popstate missing state → replay search landing", nav.url);
        }
        if (!nav || !nav.url) return;
        nav = cpHistoryReplayNav(nav);
        if (!nav) {
          cpPopReplaying = false; cpPopScroll = null;
          // Keep the address aligned with the still-painted page when its
          // known navigation is available; never replace it with rejected data.
          var paintedUrl = document.documentElement.getAttribute('data-cp-path') || cpInitialNav && cpInitialNav.url;
          var currentNav = cpHistoryReplayNav(cpLastNav);
          if (currentNav && currentNav.url === paintedUrl)
            history.replaceState({cpNav:currentNav,cpDeviceOrigin:cpDeviceProfileOrigin},'',currentNav.url);
          cpUploadNotice('This saved history entry cannot be reopened safely. Open the page from its menu.');
          return;
        }
        cpPopReplaying = true;
        cpPopScroll = typeof e.state?.cpMainScroll === "number" ? e.state.cpMainScroll : 0;
        cpDbg("[pjax] popstate → replay", nav.url);
        if (Array.isArray(e.state?.cpRecentChain) && e.state.cpRecentChain.length && e.state.cpRecentChain.length <= 5 && cpRecentNav(nav)) {
          cpRecentRestore(cpRecentNav(nav),e.state.cpRecentChain);
          return;
        }
        // A child page can switch CommPilot's server-side target (for example,
        // User Addresses → Group device profile). Restore the entry context
        // before replaying the previous page, keeping the Back entry in place.
        var painted = document.documentElement.getAttribute("data-cp-path") || "";
        var scope = function (path) { return /^\/commpilot\/([^/]+)/.exec(path || "")?.[1] || ""; };
        if (nav.entry && nav.entry.url && nav.entry.url !== nav.url &&
            scope(painted) && scope(nav.url) && scope(painted) !== scope(nav.url)) {
          var entry = { url: nav.entry.url, params: nav.entry.params || {} };
          cpPendingNav = { url: nav.url, params: nav.params || {}, replace: true, after: entry };
          window.redirectPost(entry.url, entry.params);
        } else window.redirectPost(nav.url, nav.params || {});
      } catch (err) { cpPopReplayEnd(); console.warn("[pjax] popstate replay failed", err); }
    }, false);

    try {
      if (
        !onLogin &&
        sessionStorage.getItem("cp-pending-return") === "1"
      ) {
        sessionStorage.removeItem("cp-pending-return");
        var savedLast = JSON.parse(sessionStorage.getItem("cp-last-nav") || "null");
        var last = cpLoginReturnNav(savedLast);
        if (savedLast && !last) sessionStorage.removeItem("cp-last-nav");
        // A new session starts at the account's home level, and CommPilot opens an entity only from the level
        // above it (a group from its service provider, a user from its group). Reopen the page only when its
        // entry (or, without one, the page itself) belongs to the home level; otherwise stay home.
        if (last && last.url && !cpReturnReachable(last)) {
          cpDbg("[pjax] auto-return skipped: not reachable from home", last.url);
          sessionStorage.removeItem("cp-last-nav");
          last = null;
        }
        if (last && last.url) {
          sessionStorage.setItem("cp-last-nav", JSON.stringify(last));
          cpDbg("[pjax] auto-return →", last.url);
          sessionStorage.setItem("cp-return-at", String(Date.now()));
          setTimeout(function () {
            try {
              // A fresh login's server context is HOME — re-enter the entity first when the saved nav is
              // entity-scoped, then chain to the page (cpPendingNav). Direct replay alone → "no target object".
              if (last.entry && last.entry.url && last.entry.url !== last.url) {
                var entry = { url: last.entry.url, params: last.entry.params || {} };
                cpPendingNav = { url: last.url, params: last.params || {}, after: entry };
                window.redirectPost(entry.url, entry.params);
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

    // The level letter (R reseller, S service provider, G group, U user) a saved place is reopened from: its
    // entry's path names the level the entity was opened at (/Reseller/ServiceProviders/Modify/ → R,
    // /ServiceProvider/Members/Modify/ → S, /Group/Members/Modify/ → G); a place without an entry is opened at
    // its own level (its path, or its folder id). "" when it cannot be told.
    function cpNavLevel(nav) {
      var m = /^\/commpilot\/(Reseller|ServiceProvider|Group|User)\//.exec(String((nav && nav.url) || ""));
      if (m) return { Reseller: "R", ServiceProvider: "S", Group: "G", User: "U" }[m[1]];
      var f = nav && nav.params && (nav.params.folder || nav.params.P_folder);
      return f && /^[RSGU]\d+$/.test(f) ? f.charAt(0) : "";
    }
    // The level this page's sidebar belongs to (its folder ids' letter).
    function cpSidebarLevel() {
      var a = document.querySelector('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen');
      var t = a ? cpFolderTarget(a) : null;
      return t && /^[RSGU]\d+$/.test(t.folder || "") ? t.folder.charAt(0) : "";
    }
    function cpReturnReachable(nav) {
      var home = cpSidebarLevel(), from = cpNavLevel(nav.entry && nav.entry.url ? nav.entry : nav);
      return !!home && from === home;
    }
    function cpHistoryReplayNav(value) {
      // History can survive an extension update. Reject old actions at replay
      // time as well as preventing new form saves from entering history.
      function pageNav(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || cpNavigationAddressError(item.url)) return null;
        var address = new URL(item.url,location.href), route;
        try { route = decodeURIComponent(address.pathname); } catch (e) { return null; }
        if (route.indexOf('/commpilot/') !== 0 || /\/(?:Login|Logout|servlet|Delete)(?:\/|$)/i.test(route)) return null;
        function unsafe(name,val) {
          return /^(?:ok|apply|delete|cancel|save|submit)$/i.test(name) || /password|secret|passcode|^pin$/i.test(name) ||
            /^buttonClicked$/i.test(name) && /^(?:ok|apply|delete|cancel|save|submit)$/i.test(String(val || '').trim());
        }
        for (var pair of address.searchParams) if (unsafe(pair[0],pair[1]) || /^formtokenserial$/i.test(pair[0])) return null;
        var source = item.params || {}, params = {};
        if (typeof source !== 'object' || Array.isArray(source)) return null;
        for (var key of Object.keys(source)) {
          var val = source[key];
          if (key === '__cpFormEntries') {
            // Native search forms store their criteria as ordered form entries.
            // Other serialized forms are saves, not navigation.
            if (!/^\/commpilot\/Common\/(?:find|findAll|page|sort)\.jsp$/.test(route) || !Array.isArray(val)) return null;
            var entries = [];
            for (var field of val) {
              if (!Array.isArray(field) || field.length !== 2 || typeof field[0] !== 'string' ||
                  typeof field[1] !== 'string' || unsafe(field[0],field[1])) return null;
              if (!/^formtokenserial$/i.test(field[0])) entries.push([field[0],field[1]]);
            }
            params[key] = entries;
          } else {
            if (unsafe(key,val) || val !== null && typeof val === 'object') return null;
            if (!/^(?:formtokenserial|__proto__|constructor|prototype)$/i.test(key)) params[key] = val;
          }
        }
        return {url:address.pathname+address.search,params:params};
      }
      var nav = pageNav(value);
      if (!nav) return null;
      if (value.entry) {
        nav.entry = pageNav(value.entry);
        if (!nav.entry) return null;
      }
      return nav;
    }
    function cpLoginReturnNav(value) {
      // An old tab may retain records written before form submissions were
      // excluded. Validate both hops before the first POST in the new session.
      function pageNav(item) {
        var nav = cpRecentNav(item);
        if (!nav) return null;
        var source = item.params || {};
        if (Object.keys(source).some(function (key) {
          return /^(?:ok|apply|delete|cancel|save|submit|__cpFormEntries)$/i.test(key) ||
            /^buttonClicked$/i.test(key) && String(source[key] || '').trim() !== '' ||
            source[key] !== null && typeof source[key] === 'object';
        })) return null;
        return nav;
      }
      var nav = pageNav(value);
      if (!nav) return null;
      if (value.entry) {
        nav.entry = pageNav(value.entry);
        if (!nav.entry) return null;
      }
      return nav;
    }

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
        if (!cpNativeInlineScript(old)) continue;
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
      if (cpBulkOwner) return;
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
              if (!res || res.auth === false || !res.doc) { resolve(null); return; }
              var newTok = res.doc.getElementsByName("formtokenserial")[0];
              if (newTok) {
                var tokens = document.getElementsByName("formtokenserial");
                for (var i = 0; i < tokens.length; i++) tokens[i].value = newTok.value;
              }
              // Navigation cancels the board paint, not the token consumed by
              // this completed read. Its replacement must reach the next POST.
              if (cpSectionAborted) { resolve(null); return; }
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
      U: ["/User/DND/", "/User/CW/", "/User/RemoteOffice/", "/User/CF/Always/", "/User/CF/Busy/", "/User/CF/Not_Reachable/",
        "/User/CallingNameDelivery/", "/User/CallingNumberDelivery/", "/User/CF/AlwaysSecondary/", "/User/CF/No_Answer/",
        "/User/SCF/", "/User/CallMeNow/", "/User/HotelingHost/", "/User/MWIMobile/", "/User/Icn/",
        "/User/GroupNightForwarding/", "/User/AutomaticHoldRetrieve/"]
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
      "/User/CF/Always/": 2,
      "/User/CallingNameDelivery/": 2,
      "/User/CallingNumberDelivery/": 2,
      "/User/CF/AlwaysSecondary/": 2,
      "/User/CF/No_Answer/": 2,
      "/User/SCF/": 2,
      "/User/HotelingHost/": 2,
      "/User/MWIMobile/": 2
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
      var choices = r.edit && r.edit.options || [["true", "On"], ["false", "Off"]];
      var old = isChoice ? (r.edit.options ? r.edit.current : r.value === "On" ? "true" : "false") : (r.empty ? "" : pill.textContent);
      var wrap = pill.parentNode;
      var inp = document.createElement(isChoice ? "select" : "input");
      inp.className = "cp-leaf-editin";
      if (isChoice) {
        choices.forEach(function (pair) {
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
            var display = isChoice ? choices.filter(function (c) { return c[0] === nv; })[0][1] : (nv || "None");
            if (r.edit.options) r.edit.current = nv;
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
      return cpLeafSaveChecked(edit, newValue, null).then(function (result) { return result.ok; });
    }
    // check(form) may refuse a save before anything is sent: it returns a reason, or nothing to go ahead.
    // Resolves { ok, reason }: reason is check()'s, "refused" (CommPilot did not keep the value) or "failed".
    function cpLeafSaveChecked(edit, newValue, check) {
      // Same ownership rule as cpFetchLeaf: once an option opens (or the board is gone), stop before the next
      // POST instead of sending it with the token the navigation now owns. A skipped step reports "not saved".
      var ownerBoard = document.querySelector(".cp-console");
      var saveStarted = false;
      function owned() { return !cpSectionAborted && !cpNavPending && !!ownerBoard && ownerBoard.isConnected; }
      return new Promise(function (settle) {
        var resolve = function (value) {
          settle(value === true ? { ok: true } : value && typeof value === "object" ? value : { ok: false, reason: "failed" });
        };
        cpEnqueueSection(function () {
          if (!owned()) { resolve(false); return; }
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
            var refusal = check && check(form);
            if (refusal) { resolve({ ok: false, reason: refusal }); return; }
            var type = edit.type || "text";
            var sourceInputs = [].slice.call(form.getElementsByTagName("input")).filter(function (el) { return el.name === edit.name && el.type === type; });
            if ((type === "radio" && (sourceInputs.length < 2 || !sourceInputs.some(function (el) { return el.value === newValue; }))) ||
              (type !== "radio" && sourceInputs.length !== 1)) { resolve(false); return; }
            var targetInput = type === 'radio' ? sourceInputs.filter(function (el) { return el.value === newValue; })[0] : sourceInputs[0];
            if (targetInput.matches(':disabled') || targetInput.readOnly || form.querySelector('[name="apply"]').matches(':disabled')) {
              resolve({ ok: false, reason: 'disabled' }); return;
            }
            var params = {};
            [].slice.call(form.querySelectorAll("input, select, textarea")).forEach(function (el) {
              if (!el.name || el.matches(':disabled')) return;
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
            if (!owned()) { resolve(false); return; }
            var tok2 = document.getElementsByName("formtokenserial")[0];
            saveStarted = true;
            return cpFollow(edit.path, params, tok2 ? tok2.value : null, 0).then(function (res2) {
              if (!res2 || res2.auth === false || res2.err || !res2.doc) { resolve({ ok: false, reason: "uncertain" }); return; }
              var nt2 = res2.doc.getElementsByName("formtokenserial")[0];
              if (nt2) { var ts2 = document.getElementsByName("formtokenserial"); for (var j = 0; j < ts2.length; j++) ts2[j].value = nt2.value; }
              if (!cpLeafMatches(res2.doc, edit, newValue)) { resolve({ ok: false, reason: "refused" }); return; }
              if (!owned()) { resolve({ ok: false, reason: "uncertain" }); return; }
              var tok3 = document.getElementsByName("formtokenserial")[0];
              return cpFollow(edit.path, {}, tok3 ? tok3.value : null, 0).then(function (res3) {
                if (!res3 || res3.auth === false || res3.err || !res3.doc) { resolve({ ok: false, reason: "uncertain" }); return; }
                var nt3 = res3.doc.getElementsByName("formtokenserial")[0];
                if (nt3) { var ts3 = document.getElementsByName("formtokenserial"); for (var k = 0; k < ts3.length; k++) ts3[k].value = nt3.value; }
                resolve(cpLeafMatches(res3.doc, edit, newValue) ? true : { ok: false, reason: "uncertain" });
              });
            });
          }).catch(function () { resolve({ ok: false, reason: saveStarted ? "uncertain" : "failed" }); });
        });
      });
    }

    // One background read of a page for the board on screen, in the board's read queue. A read belongs to
    // the board that asked for it. Once that board is gone (the user opened an option), a queued read must
    // never run: it would spend the next page's single-use token — or, at another level, move CommPilot's
    // server-side context — behind the user's back. Resolves the parsed page, or null.
    function cpReadBoardPage(path) {
      var ownerBoard = document.querySelector(".cp-console");
      return new Promise(function (resolve) {
        cpEnqueueSection(function () {
          if (cpSectionAborted || !ownerBoard || !ownerBoard.isConnected) { resolve(null); return; }
          // Scrolling to an option can reveal a dock just as that option's navigation starts. The navigation
          // owns the token now; let it finish (it replaces the board) instead of racing it.
          if (cpNavPending) return cpNavPending.then(function () { resolve(null); });
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          var token = liveTokEl ? liveTokEl.value : null;
          return cpFollow(path, {}, token, 0)
            .then(function (res) {
              if (!res || res.auth === false || !res.doc) { resolve(null); return; }
              var newTok = res.doc.getElementsByName("formtokenserial")[0];
              if (newTok) {
                var tokens = document.getElementsByName("formtokenserial");
                for (var i = 0; i < tokens.length; i++) tokens[i].value = newTok.value;
              }
              if (cpSectionAborted || !ownerBoard.isConnected) { resolve(null); return; }
              resolve(res.doc);
            })
            .catch(function () { resolve(null); });
        });
      });
    }

    // The breadcrumb's extension and number chips (enhancer.js): when a user's board opens (or a hunt group's, an
    // auto attendant's or a call center's, which have user boards too), read the extension and phone number from
    // the board's own Addresses option, first in the board's read queue. The result is marked on the id element
    // (data-cp-extension-state loading|done|failed, data-cp-extension, data-cp-number) and announced with
    // cp:user-extension; enhancer.js keeps it for the entity, so each is read once a session.
    function cpUserIdElement() {
      var cells = document.querySelectorAll("td.headerBar");
      for (var i = 0; i < cells.length; i++) {
        var id = cells[i].querySelector("span.headerAuthLevel");
        if (id) return id;
      }
      return null;
    }
    function cpIdText(el) { return String(el && el.textContent || "").replace(/^\s*:\s*/, "").replace(/\s+/g, " ").trim(); }
    function cpMarkSavedAddresses(doc, params, user) {
      var id = doc.querySelector('td.headerBar span.headerAuthLevel');
      if (!id || cpIdText(id) !== user) return;
      var errors = doc.querySelectorAll('td.error, span.Failure');
      for (var i = 0; i < errors.length; i++) if ((errors[i].textContent || "").trim()) return;
      // Apply returns the server's current fields; OK can return the Profile menu with no fields.
      // In that successful response use the accepted submission, without another costly Addresses read.
      var field = doc.querySelector('input[name="extension"]');
      var phone = doc.querySelector('select[name="phoneNumber"], input[name="phoneNumber"]');
      var extension = field ? field.getAttribute("value") || "" : params.extension;
      var number = phone ? phone.value : params.phoneNumber;
      id.setAttribute("data-cp-extension", String(extension || "").trim());
      id.setAttribute("data-cp-number", String(number || "").trim());
      id.setAttribute("data-cp-extension-state", "done");
      // The marked server header is copied into the live breadcrumb before cp:reskin; enhancer.js then
      // replaces both cached values, including the empty values initially known for a newly created user.
    }
    function cpMarkSavedName(doc,params,user) {
      var id = doc.querySelector('td.headerBar span.headerAuthLevel');
      if (!id || cpIdText(id) !== user || [].slice.call(doc.querySelectorAll('td.error, span.Failure')).some(function(el){return (el.textContent || '').trim();})) return;
      var first = doc.querySelector('input[name="firstName"]'), last = doc.querySelector('input[name="lastName"]');
      var name = [first ? first.getAttribute('value') : params.firstName,last ? last.getAttribute('value') : params.lastName]
        .map(function(value){return String(value || '').trim();}).filter(Boolean).join(' ');
      id.setAttribute('data-cp-user-name',name); id.setAttribute('data-cp-name-state','done');
    }
    function cpReadUserName() {
      var id = cpUserIdElement(), user = cpIdText(id), board = document.querySelector('.cp-console');
      if (!user || !board || id.hasAttribute('data-cp-name-state') ||
          ![].slice.call(document.querySelectorAll('td.headerBar a.headerAuthLevelLink')).some(function(el){return /^\s*users\s*$/i.test(el.textContent || '');})) return;
      id.setAttribute('data-cp-name-state','loading');
      cpReadBoardPage('/commpilot/User/Profile/').then(function(doc){
        var live = cpUserIdElement();
        if (!live || !board.isConnected || cpIdText(live) !== user) return;
        var first = doc && doc.querySelector('input[name="firstName"]'), last = doc && doc.querySelector('input[name="lastName"]');
        if (!first || !last || cpIdText(doc.querySelector('td.headerBar span.headerAuthLevel')) !== user ||
            [].slice.call(doc.querySelectorAll('td.error, span.Failure')).some(function(el){return (el.textContent || '').trim();})) {
          live.setAttribute('data-cp-name-state','failed'); return;
        }
        live.setAttribute('data-cp-user-name',[first.getAttribute('value'),last.getAttribute('value')].map(function(value){return String(value || '').trim();}).filter(Boolean).join(' '));
        live.setAttribute('data-cp-name-state','done'); document.dispatchEvent(new Event('cp:user-name'));
      });
    }
    function cpReadUserExtension() {
      var id = cpUserIdElement(), user = cpIdText(id);
      if (!user || id.hasAttribute("data-cp-extension-state")) return;
      var mark = function (state, ext, number) {
        var live = cpUserIdElement();   // pjax may have rewritten the header since the read started
        if (!live || cpIdText(live) !== user) return;
        live.setAttribute("data-cp-extension-state", state);
        if (state === "done") { live.setAttribute("data-cp-extension", ext); live.setAttribute("data-cp-number", number || ""); }
        document.dispatchEvent(new Event("cp:user-extension"));
      };
      // A user's Addresses is /User/Addresses/; a service's is its own (/Group/Hunt_Group/Addresses/index.jsp?key=…).
      var board = document.querySelector(".cp-console"), path = "/commpilot/User/Addresses/";
      [].slice.call(board ? board.querySelectorAll("a.navMenuItem[name]") : []).some(function (a) {
        if (!/^\s*addresses\s*$/i.test(a.textContent || "")) return false;
        path = "/commpilot" + a.getAttribute("name");
        return true;
      });
      mark("loading");
      cpReadBoardPage(path).then(function (doc) {
        var field = doc && doc.querySelector('input[name="extension"]');
        // The Addresses page must be this entity's: CommPilot answers for its current target, not for a URL.
        if (!field || cpIdText(doc.querySelector("td.headerBar span.headerAuthLevel")) !== user) { mark("failed"); return; }
        var select = doc.querySelector('select[name="phoneNumber"]');
        var chosen = select && (select.querySelector("option[selected]") || select.options[select.selectedIndex]);
        var number = chosen ? chosen.value : (doc.querySelector('input[name="phoneNumber"]') || {}).value;
        mark("done", String(field.getAttribute("value") || "").trim(), String(number || "").trim());
      });
    }

    function cpFetchLeaf(path) {
      if (cpBulkOwner) return Promise.resolve(null);
      return cpReadBoardPage(path).then(function (doc) {
        return new Promise(function (resolve) {
          if (!doc) { resolve(null); return; }
          var cell = doc.querySelector('td[width="82%"]');
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
            // A summary must preserve the native field's privacy: hidden values
            // and masked credentials must never become readable glance text.
            if (inp && /^(?:password|hidden|file)$/i.test(inp.type || "")) continue;
            var val = inp ? (inp.value || "") : (tds[1].textContent || "").trim();
            if (!val) continue;
            // defpill (lavender value pill) — the console-wide glance style (user: make Profile match the
            // CRP/email cards; the old plain-text .cp-leaf-val rendering predated the pill standard).
            out.push({ label: label.replace(/:\s*$/, ""), value: val.slice(0, 80), kind: "defpill", empty: false });
          }
          resolve(out.length ? out : null);
        });
      }).catch(function () { return null; });
    }

    function cpSummarizeLeaves(bodyEl, reserveOnly) {
      // Menu previews can be switched off in the Settings popup (theme-settings.js: html[data-cp-peek="off"]).
      if (!bodyEl || document.documentElement.getAttribute("data-cp-peek") === "off") return;
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
            } else if (r.kind === "defpill" && r.edit && !r.edit.options && (r.edit.type === "radio" || r.edit.type === "checkbox")) {
              // An on/off setting: the same On | Off control as the service's own switch; a click saves it.
              v = document.createElement("span");
              v.className = "cp-leaf-valwrap";
              (function (rr) {
                var sw = cpSegSwitch(rr.label);
                sw.classList.add("cp-leaf-switch");
                cpSegShow(sw, rr.value === "On");
                sw.addEventListener("click", function (ev) {
                  ev.stopPropagation(); ev.preventDefault();
                  var want = cpSegWants(sw, ev);
                  if (want === null || sw.classList.contains("cp-svc-busy")) return;
                  cpSegShow(sw, want);
                  sw.classList.add("cp-svc-busy");
                  sw.setAttribute("aria-busy", "true");
                  cpLeafSave(rr.edit, want ? "true" : "false").then(function (good) {
                    sw.classList.remove("cp-svc-busy");
                    sw.removeAttribute("aria-busy");
                    if (good) rr.value = want ? "On" : "Off";
                    else cpSegShow(sw, !want);
                    sw.classList.add(good ? "cp-svc-saved" : "cp-svc-failed");
                    setTimeout(function () { sw.classList.remove("cp-svc-saved", "cp-svc-failed"); }, 1200);
                  });
                });
                v.appendChild(sw);
              })(r);
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

    // Service switches. A user's menu options that end in "- On"/"- Off" get a switch at the right of the option's title
    // (the words are kept in the link, hidden, for everything that reads them). The switch flips the service in
    // place for the services whose page is a plain on/off choice (radio "active" true/false) on a small form —
    // surveyed on the sandbox 2026-09-28; the others (on/off inside a larger form, or no single on/off control)
    // show their state as a read-only pill and open like any option. A flip is Peek's save: the page is read
    // fresh, only "active" changes, Apply, and the page is read again to confirm. Switches render with their
    // section, disabled until the board has restored the user's context (settlePeekReads), like Peek's reads.
    var CP_SWITCH_ROUTES = ["/User/ACR/", "/User/AutomaticCallback/", "/User/AutomaticHoldRetrieve/", "/User/BargeinExempt/",
      "/User/CallMeNow/", "/User/CF/Always/", "/User/CF/AlwaysSecondary/", "/User/CF/Busy/", "/User/CF/No_Answer/",
      "/User/CF/Not_Reachable/", "/User/CIDB/", "/User/COLR/", "/User/CW/", "/User/DND/", "/User/ExternalCLIDDelivery/",
      "/User/HotelingHost/", "/User/ICSA/", "/User/IntegratedIMP/", "/User/InternalCLIDDelivery/", "/User/MWIMobile/",
      "/User/PhysicalLocation/", "/User/RemoteOffice/", "/User/SCF/", "/User/SilentAlerting/", "/User/VoicePortalCalling/"];
    // Services CommPilot only turns on with a number: the number's field and what it is called in Peek.
    var CP_SWITCH_NEEDS = {
      "/User/CF/Always/": ["forwardedToNumber", "Forward to"], "/User/CF/AlwaysSecondary/": ["forwardedToNumber", "Forward to"],
      "/User/CF/Busy/": ["forwardedToNumber", "Forward to"], "/User/CF/No_Answer/": ["forwardedToNumber", "Forward to"],
      "/User/CF/Not_Reachable/": ["forwardedToNumber", "Forward to"], "/User/SCF/": ["forwardedToNumber", "Forward to"],
      "/User/RemoteOffice/": ["remoteOfficeNumber", "Remote number"], "/User/MWIMobile/": ["e164MobileNumber", "Mobile number"]
    };
    // The On | Off control (the user's pick, 2026-09-28: style C): both states side by side, the current one lit —
    // green for on, red for off. It is the service's switch on an option's title and Peek's on/off rows. A click on
    // the side already lit does nothing; anywhere else flips it.
    function cpSegSwitch(label) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "cp-svc-switch";
      el.setAttribute("role", "switch");
      el.setAttribute("aria-label", label);
      el.innerHTML = '<span class="cp-seg-on" aria-hidden="true">On</span><span class="cp-seg-off" aria-hidden="true">Off</span>';
      return el;
    }
    function cpSegShow(el, on) {
      el.dataset.state = on ? "on" : "off";
      el.setAttribute("aria-checked", String(on));
    }
    function cpSegWants(el, event) {
      var side = event.target && event.target.closest && event.target.closest(".cp-seg-on, .cp-seg-off");
      var on = el.dataset.state === "on";
      if (side && side.classList.contains(on ? "cp-seg-on" : "cp-seg-off")) return null;
      return !on;
    }
    function cpServiceSwitches(bodyEl) {
      if (!bodyEl) return;
      bodyEl.querySelectorAll("a.navMenuItem[name]").forEach(function (link) {
        var cell = link.closest("td");
        if (!cell || cell.querySelector(".cp-svc-switch, .cp-svc-state")) return;
        var status = cpServiceStatus(link);
        if (!status) return;
        var route = link.getAttribute("name");
        var name = cpServiceName(link);
        var el;
        if (CP_SWITCH_ROUTES.indexOf(route) !== -1) {
          el = cpSegSwitch(name);
          el.disabled = true;
          el.title = "Available when the menu has finished loading";
          el.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (cpSegWants(el, event) !== null) cpFlipService(link, el);
          });
        } else {
          // Not a plain on/off page: the state is shown, and the option opens as usual to change it.
          el = document.createElement("span");
          el.className = "cp-svc-state";
          el.title = "Open " + name + " to change it";
        }
        cell.classList.add("cp-svc-cell");
        cell.appendChild(el);
        cpShowServiceState(link, el, status.dataset.bwState === "on");
      });
    }
    // The "- On"/"- Off" words at the end of the option's link, wrapped as enhancer.js's colorize() would (it then
    // leaves them alone); the switch or state pill replaces them on screen.
    function cpServiceStatus(link) {
      var existing = link.querySelector(".bw-on-off-status[data-bw-owned='1']");
      if (existing) return existing;
      var m = /^([\s\S]*?)(\s*-\s*)(On|Off)\s*$/i.exec(link.textContent || "");
      if (!m) return null;
      // The words can span text nodes (CommPilot: "Name - <span class="serviceOff">Off</span>"): wrap each piece.
      var start = m[1].length, end = start + m[2].length + m[3].length, offset = 0, pieces = [];
      var walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        var node = walker.currentNode, next = offset + node.textContent.length;
        pieces.push({ node: node, start: offset, end: next });
        offset = next;
      }
      var first = null;
      pieces.forEach(function (piece) {
        var from = Math.max(start, piece.start) - piece.start, to = Math.min(end, piece.end) - piece.start;
        if (to <= from) return;
        var part = from ? piece.node.splitText(from) : piece.node;
        if (part.textContent.length > to - from) part.splitText(to - from);
        var span = document.createElement("span");
        span.className = "bw-on-off-status";
        span.dataset.bwOwned = "1";
        span.dataset.bwState = m[3].toLowerCase();
        part.replaceWith(span);
        span.appendChild(part);
        first = first || span;
      });
      link.dataset.bwColoredLabel = link.textContent || "";
      return first;
    }
    function cpServiceName(link) {
      return (link.textContent || "").replace(/\s*-\s*(On|Off)\s*$/i, "").replace(/\s+/g, " ").trim();
    }
    function cpShowServiceState(link, el, on) {
      var name = cpServiceName(link);
      // CommPilot's label can split the words over several status spans (" - " and <span class="serviceOff">Off</span>):
      // the word is in the last one.
      if (cpServiceStatus(link)) {
        var parts = link.querySelectorAll(".bw-on-off-status[data-bw-owned='1']");
        [].forEach.call(parts, function (part) { part.dataset.bwState = on ? "on" : "off"; });
        var last = parts[parts.length - 1];
        last.textContent = last.textContent.replace(/(On|Off)(\s*)$/i, (on ? "On" : "Off") + "$2");
        var native = last.closest(".serviceOn, .serviceOff");
        if (native) native.className = on ? "serviceOn" : "serviceOff";
        link.dataset.bwColoredLabel = link.textContent || "";
      }
      el.dataset.state = on ? "on" : "off";
      if (el.matches(".cp-svc-switch")) {
        cpSegShow(el, on);
        if (!el.disabled) el.title = "Turn " + name + " " + (on ? "off" : "on");
      } else {
        el.textContent = on ? "On" : "Off";
      }
    }
    function cpEnableServiceSwitches(board) {
      board.querySelectorAll(".cp-svc-switch:disabled:not(.cp-svc-busy)").forEach(function (el) {
        el.disabled = false;
        el.title = "Turn " + el.getAttribute("aria-label") + " " + (el.dataset.state === "on" ? "off" : "on");
      });
    }
    function cpFlipService(link, el) {
      if (el.disabled || el.classList.contains("cp-svc-busy")) return;
      var route = link.getAttribute("name"), name = cpServiceName(link);
      var was = el.dataset.state === "on", on = !was;
      var needs = CP_SWITCH_NEEDS[route];
      cpServiceNote(link, null);
      cpShowServiceState(link, el, on);   // the switch moves at once; it moves back if CommPilot does not agree
      el.classList.add("cp-svc-busy");
      el.setAttribute("aria-busy", "true");
      cpLeafSaveChecked({ path: "/commpilot" + route, name: "active", type: "radio" }, on ? "true" : "false", function (form) {
        // A page that has grown beyond a plain on/off choice is changed on the page itself.
        var settable = {};
        [].slice.call(form.querySelectorAll("input, select, textarea")).forEach(function (f) {
          var t = (f.type || "").toLowerCase();
          if (f.name && !/^(hidden|submit|button|image|reset)$/.test(t)) settable[f.name] = true;
        });
        if (Object.keys(settable).length > 3 || form.querySelector("select[multiple]")) return "complex";
        if (on && needs) {
          var number = [].slice.call(form.querySelectorAll('input[type="text"]')).filter(function (f) { return f.name === needs[0]; })[0];
          if (number && !(number.value || "").trim()) return "needs";
        }
      }).then(function (result) {
        el.classList.remove("cp-svc-busy");
        el.removeAttribute("aria-busy");
        if (!el.isConnected) return;
        if (result.ok) {
          cpShowServiceState(link, el, on);
          el.classList.add("cp-svc-saved");
          setTimeout(function () { el.classList.remove("cp-svc-saved"); }, 1200);
          return;
        }
        cpShowServiceState(link, el, was);
        var message = result.reason === "needs" ? name + " needs a " + needs[1].toLowerCase() + " number before it can be turned on." :
          result.reason === "disabled" ? "CommPilot has disabled this setting. Open " + name + " to review it." :
          result.reason === "complex" ? "Open " + name + " to turn it " + (on ? "on" : "off") + ": its page has more settings." :
          result.reason === "refused" ? "CommPilot did not turn " + name + " " + (on ? "on" : "off") + ". Open it to see why." :
          result.reason === "uncertain" ? "The save could not be confirmed. Open " + name + " to check its current setting before retrying." :
          "Could not reach CommPilot. " + name + " was not changed.";
        cpServiceNote(link, message, result.reason === "needs");
        // Missing number: open Peek's editor for it, when the option shows one.
        if (result.reason === "needs") {
          var dock = link.closest("tr") && link.closest("tr").nextElementSibling;
          var rows = dock ? dock.querySelectorAll(".cp-leaf-summary .cp-leaf-row") : [];
          [].forEach.call(rows, function (row) {
            var key = row.querySelector(".cp-leaf-key");
            var edit = row.querySelector('.cp-leaf-actbtn[aria-label="Edit value"]');
            if (key && edit && key.title === needs[1]) edit.click();
          });
        }
      });
    }
    // A short message under the option's description (why a switch moved back).
    function cpServiceNote(link, message, keep) {
      var titleRow = link.closest("tr"), descRow = titleRow && titleRow.nextElementSibling;
      var cell = descRow && descRow.querySelector("td");
      if (!cell) return;
      var old = cell.querySelector(".cp-svc-note");
      if (old) old.remove();
      if (!message) return;
      var note = document.createElement("div");
      note.className = "cp-svc-note";
      note.setAttribute("role", "status");
      note.textContent = message;
      var peek = cell.querySelector(".cp-leaf-summary");
      cell.insertBefore(note, peek || null);
      setTimeout(function () { if (note.isConnected) note.remove(); }, keep ? 12000 : 8000);
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
        return { label:label, value:value || "None", kind:"defpill", empty:!value, keepLabel:true,
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
      // The service's own on/off is its switch in the option's title row (cpServiceSwitches), not a Peek row.
      if (route === "/User/DND/") {
        var splash = checked("ringSplash");
        if (splash === null) return null;
        return [toggle("Ring splash", "ringSplash", "checkbox", splash)];
      }
      if (route === "/User/CW/") {
        var hideId = checked("disableCLID");
        if (hideId === null) return null;
        return [toggle("Hide caller ID", "disableCLID", "checkbox", hideId)];
      }
      if (route === "/User/RemoteOffice/") {
        var remoteNumber = editableText("Remote number", "remoteOfficeNumber");
        return remoteNumber ? [remoteNumber] : null;
      }
      // A radio group with more than on/off: its choices, labelled as on the page.
      function choice(label, name, labels) {
        var value = radio(name);
        if (value === null || !labels[value]) return null;
        return { label:label, value:labels[value], kind:"defpill", empty:false, copy:false, keepLabel:true,
          edit:{ path:path, name:name, type:"radio", current:value,
            options:Object.keys(labels).map(function (v) { return [v, labels[v]]; }) } };
      }
      if (route === "/User/CallingNameDelivery/" || route === "/User/CallingNumberDelivery/") {
        var external = radio("external"), internal = radio("internal");
        if (external === null || internal === null) return null;
        return [toggle("External calls", "external", "radio", external === "true"),
          toggle("Internal calls", "internal", "radio", internal === "true")];
      }
      if (route === "/User/CallMeNow/") {
        var confirm = choice("Answer confirmation", "answerConfirmation", { "None": "None", "Any Key": "Any key", "Passcode": "Passcode" });
        return confirm ? [confirm] : null;
      }
      if (route === "/User/GroupNightForwarding/") {
        var night = choice("Night forwarding", "gnfActive", { "Use Group": "Use group setting", "On": "On", "Off": "Off" });
        return night ? [night] : null;
      }
      if (route === "/User/HotelingHost/") {
        var enforce = checked("enforceAssociationLimit"), hours = editableText("Limit (hours)", "associationLimit");
        if (enforce === null || !hours) return null;
        return [toggle("Association limit", "enforceAssociationLimit", "checkbox", enforce), hours];
      }
      if (route === "/User/MWIMobile/") {
        var mobile = editableText("Mobile number", "e164MobileNumber"), missed = checked("sendMca");
        if (!mobile || missed === null) return null;
        return [mobile, toggle("Missed call alert", "sendMca", "checkbox", missed)];
      }
      if (route === "/User/Icn/") {
        var mail = editableText("E-mail to", "toAddress");
        return mail ? [mail] : null;
      }
      if (route === "/User/AutomaticHoldRetrieve/") {
        var recall = editableText("Recall timer (seconds)", "recallTimerSeconds");
        return recall ? [recall] : null;
      }
      if (route === "/User/CF/No_Answer/") {
        var noAnswerTo = editableText("Forward to", "forwardedToNumber"), rings = selectValue("numberOfRings");
        if (!noAnswerTo) return null;
        return rings === null ? [noAnswerTo] : [noAnswerTo, { label:"Rings", value:rings }];
      }
      if (route === "/User/CF/Always/" || route === "/User/CF/Busy/" || route === "/User/CF/Not_Reachable/" ||
          route === "/User/CF/AlwaysSecondary/" || route === "/User/SCF/") {
        var destination = editableText("Forward to", "forwardedToNumber");
        if (!destination) return null;
        var forwardingRows = [destination];
        if (route === "/User/CF/Always/" || route === "/User/CF/AlwaysSecondary/" || route === "/User/SCF/") {
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
      var trail = [].slice.call(crumb.querySelectorAll(".cp-bc-seg, .cp-bc-cur")).map(function (p) { return (p.textContent || "").trim(); });
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
    // A sidebar folder's target, read the way CommPilot wires it: an onclick, or the wiring script beside the link
    // (redirectPost(folder_contents, {folder: 'G0', menuId: '1'})). Stamped on the link (data-cp-folder / -menuid)
    // so the folder-click takeover can replay the navigation itself.
    function cpFolderTarget(a) {
      var known = a.getAttribute("data-cp-folder");
      if (known) return { folder: known, menuId: a.getAttribute("data-cp-menuid") || "8" };
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
            if (!cpNativeInlineScript(scripts[si])) continue;
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
      if (!folder) return null;
      a.setAttribute("data-cp-folder", folder);
      a.setAttribute("data-cp-menuid", menuId);   // used by the folder-click takeover (below) to replay the nav safely
      return { folder: folder, menuId: menuId };
    }

    function cpBuildConsole() {
      if (cpBulkOwner) return;
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
        var target = cpFolderTarget(a);
        if (!target) return;
        folders.push({ name: name, folder: target.folder, menuId: target.menuId });
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
      // way to restore the server context after the folder reads, unless it
      // is the landing page of a reload replay (see cpReloadEntry).
      if (aggLevel && (!cpEntityEntry || !cpEntityEntry.url) && cpReloadEntry) {
        cpEntityEntry = cpReloadEntry;
        if (cpEntityEntry.url.indexOf("/Common/folder_contents.jsp") === -1) cpDeepEntry = cpEntityEntry;
      }
      cpReloadEntry = null;
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
        // An option's own link: in this row, not in a table nested in it. CommPilot's Basic and Advanced columns sit
        // side by side in one layout row; the empty space under the shorter one is in that row and must open nothing.
        var ownLink = function (tr) {
          var a = tr && tr.querySelector("a.navMenuItem");
          return a && a.closest("tr") === tr ? a : null;
        };
        var titleRow = ownLink(row) ? row : row.previousElementSibling;
        if (!titleRow || (titleRow !== row && titleRow.nextElementSibling !== row)) return;
        var link = ownLink(titleRow);
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
        headIco.className = "cp-console-head-ico";   // the folder's sidebar icon; native-theme.js maps the name
        headIco.setAttribute("data-cp-name", f.name.replace(/\s+/g, " ").toLowerCase());
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
    // The latest section jump. Late content growth above it can re-pin that target without drifting.
    // Updated on every sidebar click, cleared by manual scrolling, and gated on "still near the top"
    // at re-pin time. Keeping an old target here lets a Peek response cancel a newer smooth scroll.
    var cpJumpAnchorSec = null;
    // A section picked in the sidebar while the board is still filling in: it stays at the top while sections
    // above it appear (instead of being pushed down, or the reveal re-pinning its own anchor), until you scroll.
    var cpUserPin = null;
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
          try { cpServiceSwitches(bodyEl); } catch (e) { console.warn("[pjax] service switches", e); }
          cpRevealSection(sec, aboveAnchor);   // animated cascade for anchor + below; plain show for above
          document.dispatchEvent(new Event("cp:reskin"));   // wrapMenuCards etc. → the section's FINAL height
          if (/^[RGU]\d+$/.test(folder || "")) cpSummarizeLeaves(bodyEl, true);
          cpReexecWiringScripts(bodyEl);
          cpSetSectionCount(bodyEl);
          // An above-anchor section was just inserted above the pinned anchor. Re-pin the anchor flush
          // to the console top — an ABSOLUTE, idempotent scroll (sets the exact position, no per-section
          // delta to accumulate so nothing drifts), the same alignment the sidebar click uses. After
          // reskin, so heights are final.
          if (cpUserPin && document.contains(cpUserPin) && cpUserPin !== sec &&
              (sec.compareDocumentPosition(cpUserPin) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            var upCons = document.querySelector(".cp-console");
            if (upCons) {
              upCons.scrollTop += (cpUserPin.getBoundingClientRect().top - upCons.getBoundingClientRect().top);
              cpRevealAboveOffscreen(upCons);
            }
          } else if (aboveAnchor && anchorSec && document.contains(anchorSec) && !cpUserPin) {
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
          cpSectionRetry(sec, aboveAnchor, anchorSec, null);
        }
        if (done) done();
      });
    }

    // The "Couldn’t load — Retry" button of a section without content. Only its click reads the folder again; `lift`
    // runs first, for a board whose reads were stopped (cpStoppedBoardRetry).
    function cpSectionRetry(sec, aboveAnchor, anchorSec, lift) {
      var bodyEl = sec.querySelector(".cp-console-body");
      var retryBtn = document.createElement("button");
      retryBtn.textContent = "Couldn’t load — Retry";
      retryBtn.style.cssText = "background:none;border:1px solid var(--cp-border, #3c3a37);border-radius:6px;padding:6px 14px;color:var(--cp-text, #e8e8e8);cursor:pointer;font:inherit;";
      retryBtn.addEventListener("click", function () {
        if (lift) lift();
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

    // An option opened while a reseller board is still reading its folders stops those reads (cpSectionAborted). When
    // that option fails, the board stays, and its unread folders would stay hidden or "Loading…" for good. They get
    // the Retry button instead. Nothing is read until the user presses it, since the failed answer may not have
    // carried a fresh token; the stop is lifted then, unless a newer navigation has started since.
    function cpStoppedBoardRetry() {
      var board = document.querySelector(".cp-console");
      if (!cpSectionAborted || cpBulkOwner || !board) return;
      var seq = cpSeq;
      cpUserPin = null;   // as when a reveal finishes: nothing is filling in above a pinned section any more
      board.querySelectorAll(".cp-console-section").forEach(function (sec) {
        var bodyEl = sec.querySelector(".cp-console-body");
        sec.style.visibility = "";
        if (!bodyEl || bodyEl.getAttribute("data-cp-loaded") === "1") return;
        bodyEl.dataset.cpRequested = "1";   // a step of the stopped reveal chain still due passes it by
        if (sec.dataset.cpRevealed !== "1") cpRevealSection(sec, false);
        sec.style.display = "";
        bodyEl.innerHTML = "";
        cpSectionRetry(sec, false, null, function () {
          if (seq === cpSeq && board.isConnected && !cpBulkOwner) cpSectionAborted = false;
        });
      });
      cpFitConsoleTail();
      cpHeadFade();
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
      // A dwell callback can outlive its board. It must not end aggregation or
      // restore context for a different board that opened in the meantime.
      if (!secs.length || !document.contains(secs[0])) return;
      if (cpSectionAborted || !document.querySelector(".cp-console")) { cpRevealBusy = false; cpAggEnd(); return; }
      if (i >= order.length) {
        function settlePeekReads(ready) {
          var currentBoard = document.querySelector(".cp-console");
          if (!currentBoard || !secs.length || !document.contains(secs[0])) return;
          if (!ready || cpBoardFailed) {
            currentBoard.querySelectorAll(".cp-leaf-summary:not([data-cp-peek-started])").forEach(function (box) { box.remove(); });
            return;
          }
          try { cpHarvestPageMenu(currentBoard); cpDecorateBoardMenu(); } catch (e) { console.warn("[pjax] page menu harvest", e); }
          if (!/^[RGU]\d+$/.test(secs[0].getAttribute("data-cp-folder") || "")) return;
          if (/^U/.test(secs[0].getAttribute("data-cp-folder"))) { cpEnableServiceSwitches(currentBoard); cpReadUserExtension(); cpReadUserName(); }
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
          cpFollowFrame(restoreUrl, restoreParams, restoreToken, 0, CP_FRAME_WAIT_MS).then(function (res) {
            var restoredNav = res && res.doc && res.doc.querySelector('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen');
            var restoredTarget = restoredNav && cpFolderTarget(restoredNav);
            var expectedLevel = (secs[0].getAttribute('data-cp-folder') || '').charAt(0);
            var entityText = function (root) {return (root.querySelector('td.headerBar span.headerAuthLevel')?.textContent || '').replace(/^\s*:\s*/,'').trim();};
            var expectedEntity = entityText(document);
            var restored = !!(res && res.doc && res.doc.querySelector('td[width="82%"] a.navMenuItem') &&
              restoredTarget && restoredTarget.folder.charAt(0) === expectedLevel &&
              (!expectedEntity || entityText(res.doc) === expectedEntity));
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
        cpUserPin = null;
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
      ["wheel", "touchstart", "keydown"].forEach(function (type) {
        cons.addEventListener(type, function () {
          cpUserPin = null;
          cpJumpAnchorSec = null;   // a late Peek response must not undo a manual scroll
          cpPopScroll = null;
        }, { passive: true });
      });
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
        var opts = [].slice.call(field.options).map(function (o) {
          return { value: o.value, label: (o.textContent || "").trim() };
        });
        cpExportUsers({
          fieldOpts: opts,
          entity: (document.title || "").replace(/:\s*Group Directory\s*$/i, "").trim()
        });
      });
      search.parentNode.insertBefore(button, search);
    }

    // ---- Breadcrumb page menu ---------------------------------------------------------------------------
    // When a board finishes, every option of the level is stored (per sidebar + breadcrumb trail, so each
    // entity has its own). On that level's other pages the current page joins the breadcrumb as a pill whose
    // menu lists the level's folders and pages; choosing one navigates through PJAX with the option's own
    // redirectPost target, read from CommPilot's wiring script for that link.
    var CP_PAGE_MENU_PREFIX = "cp-page-menu:";
    var cpPageMenuMemory = null;
    function cpPageMenuKey() {
      var nav = document.querySelector('form[name="leftNavForm"]');
      var trail = [].slice.call(document.querySelectorAll('td.headerBar a.headerAuthLevelLink, td.headerBar span.headerAuthLevel'))
        .map(function (el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }).join(">");
      return CP_PAGE_MENU_PREFIX + cpSidebarSig(nav) + "|" + trail;
    }
    function cpUnescapeJs(text) {
      // Decode once: a literal escaped backslash followed by u0040 is text,
      // not a second Unicode escape to turn into an at-sign.
      return String(text).replace(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(['"\\/]))/g, function (_, unicode, hex, escaped) {
        return unicode || hex ? String.fromCharCode(parseInt(unicode || hex, 16)) : escaped;
      });
    }
    // id → {url, params} from the menu's wiring scripts (redirectPost('…', {…}) inside the link's handler).
    function cpWiringTargets(root) {
      var targets = {};
      root.querySelectorAll("script").forEach(function (script) {
        if (!cpNativeInlineScript(script)) return;
        cpScriptBindings(script.textContent || "").forEach(function (binding) {
          var target = cpParseNativeRedirect(binding.script);
          if (target) targets[binding.id] = target;
        });
      });
      root.querySelectorAll("a.navMenuItem[onclick]").forEach(function (a) {
        var target = cpParseNativeRedirect(a.getAttribute("onclick") || "");
        if (target && a.id && !targets[a.id]) targets[a.id] = target;
      });
      return targets;
    }
    function cpOptionLabel(a) {
      var copy = a.cloneNode(true);
      copy.querySelectorAll(".bw-on-off-status").forEach(function (s) { s.remove(); });
      return (copy.textContent || "").replace(/\s+/g, " ").trim().replace(/\s*-\s*(On|Off)?$/, "");
    }
    function cpHarvestPageMenu(board) {
      var folders = [];
      board.querySelectorAll(".cp-console-section").forEach(function (sec) {
        var body = sec.querySelector(".cp-console-body");
        if (!body) return;
        var targets = cpWiringTargets(body), options = [], group = "Basic";
        body.querySelectorAll(".menuCategory, a.navMenuItem").forEach(function (el) {
          if (!el.matches("a.navMenuItem")) {
            var heading = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (heading) group = heading.charAt(0).toUpperCase() + heading.slice(1).toLowerCase();
            return;
          }
          var path = el.getAttribute("name") || "";
          var target = (el.id && targets[el.id]) || (path ? { url: "/commpilot" + path, params: {} } : null);
          var label = cpOptionLabel(el);
          if (label && target) options.push({ label: label, group: group, url: target.url, params: target.params });
        });
        var name = ((sec.querySelector(".cp-console-head-name") || {}).textContent || "").trim();
        if (options.length) folders.push({ name: name || sec.getAttribute("data-cp-folder"), options: options });
      });
      if (folders.length) cpStorePageMenu(cpPageMenuKey(), { folders: folders, cachedAt: Date.now() });
    }
    function cpStorePageMenu(key, data) {
      // Menus repeat for every visited entity. Bound this expendable cache and
      // keep the current menu usable even when browser storage refuses writes.
      cpPageMenuMemory = {key:key,data:data,persisted:false};
      try {
        var older = [];
        for (var i = 0; i < sessionStorage.length; i++) {
          var storedKey = sessionStorage.key(i);
          if (!storedKey || storedKey.indexOf(CP_PAGE_MENU_PREFIX) !== 0 || storedKey === key) continue;
          var at = 0;
          try {
            var stored = JSON.parse(sessionStorage.getItem(storedKey) || 'null');
            if (stored && Number.isFinite(stored.cachedAt)) at = stored.cachedAt;
          } catch (e) {}
          older.push({key:storedKey,at:at});
        }
        older.sort(function (a,b) { return a.at-b.at; });
        while (older.length >= 64) sessionStorage.removeItem(older.shift().key);
        var text = JSON.stringify(data);
        for (;;) {
          try { sessionStorage.setItem(key,text); cpPageMenuMemory.persisted = true; return; }
          catch (e) {
            if (!e || e.name !== 'QuotaExceededError' || !older.length) return;
            sessionStorage.removeItem(older.shift().key);
          }
        }
      } catch (e) {} // Other settings, recovery records and group defaults are never evicted.
    }
    function cpMenuPath(url) {
      var p = String(url || "").replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0].replace(/index\.jsp$/, "");
      return p.charAt(p.length - 1) === "/" ? p : p + "/";
    }
    function cpReadPageMenu() {
      var key = cpPageMenuKey();
      var fallback = cpPageMenuMemory && cpPageMenuMemory.key === key ? cpPageMenuMemory : null;
      var data = fallback && !fallback.persisted ? fallback.data : null;
      if (!data) { try { data = JSON.parse(sessionStorage.getItem(key) || "null"); } catch (e) {} }
      if (!data && fallback) data = fallback.data;
      if (!data || !Array.isArray(data.folders)) return null;
      // A partial or older cache must not disable the whole level's menu. Keep only
      // complete records; never invent a navigation target or its native parameters.
      var folders = [];
      data.folders.forEach(function (folder) {
        if (!folder || typeof folder.name !== "string" || !folder.name.trim() || !Array.isArray(folder.options)) return;
        var options = folder.options.filter(function (option) {
          return option && typeof option.label === "string" && option.label.trim() &&
            typeof option.url === "string" && option.url.trim() &&
            (option.params == null || (typeof option.params === "object" && !Array.isArray(option.params))) &&
            (option.group == null || typeof option.group === "string");
        });
        if (options.length) folders.push({ name: folder.name, options: options });
      });
      return folders.length ? { folders: folders } : null;
    }
    function cpClosePageMenu() {
      var menu = document.querySelector(".cp-page-menu");
      if (menu) menu.remove();
      document.querySelectorAll(".cp-page-pill, [data-cp-crumb-menu]").forEach(function (pill) { pill.setAttribute("aria-expanded", "false"); });
      document.removeEventListener("click", cpPageMenuOutside, true);
      document.removeEventListener("keydown", cpPageMenuKeys, true);
    }
    function cpPageMenuOutside(e) {
      if (e.target.closest && e.target.closest(".cp-page-menu, .cp-page-pill, [data-cp-crumb-menu]")) return;
      cpClosePageMenu();
    }
    function cpPageMenuKeys(e) {
      if (e.key === "Escape") { cpClosePageMenu(); var pill = document.querySelector(".cp-page-pill, [data-cp-crumb-menu]"); if (pill) pill.focus(); }
    }
    function cpDecoratePageMenu() {
      cpClosePageMenu();
      var boardPill = document.querySelector("td.headerBar [data-cp-crumb-menu]");   // the board's menu stays on the board
      if (boardPill) cpUnmarkBoardMenu(boardPill);
      document.querySelectorAll(".cp-page-pill").forEach(function (p) { p.remove(); });
      var data = cpReadPageMenu();
      if (!data) return;
      var here = cpMenuPath(location.pathname), best = null;
      data.folders.forEach(function (folder) {
        folder.options.forEach(function (option) {
          var p = cpMenuPath(option.url);
          if (here.indexOf(p) === 0 && (!best || p.length > best.path.length)) best = { path: p, folder: folder, option: option };
        });
      });
      if (!best) return;
      var anchor = document.querySelector("td.headerBar span.headerAuthLevel") ||
        [].slice.call(document.querySelectorAll("td.headerBar a.headerAuthLevelLink")).pop();
      if (!anchor) return;
      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "cp-page-pill";
      pill.setAttribute("aria-haspopup", "true");
      pill.setAttribute("aria-expanded", "false");
      pill.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      pill.firstChild.textContent = best.option.label;
      pill.addEventListener("click", function (e) {
        e.stopPropagation();
        if (document.querySelector(".cp-page-menu")) { cpClosePageMenu(); return; }
        cpOpenPageMenu(pill, data, best);
      });
      anchor.parentNode.insertBefore(pill, anchor.nextSibling);
    }
    // On a board (a level's base menu) the breadcrumb's last pill opens the level's menu, as the page pill does on the
    // level's other pages: a ⌄ inside the pill, and a click on it (not on its copy icon) opens the list instead of
    // reloading the level. It lists the level's options once the board has been read through, and opens on the folder
    // at the top of the board.
    var CP_CRUMB_CARET = '<svg class="cp-crumb-caret" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    function cpBoardMenuPill() {
      var cell = [].slice.call(document.querySelectorAll("td.headerBar")).find(function (td) {
        return td.querySelector("a.headerAuthLevelLink, span.headerAuthLevel");
      });
      if (!cell) return null;
      return cell.querySelector("span.headerAuthLevel") || [].slice.call(cell.querySelectorAll("a.headerAuthLevelLink")).pop() || null;
    }
    function cpUnmarkBoardMenu(pill) {
      ["data-cp-crumb-menu", "role", "tabindex", "aria-haspopup", "aria-expanded", "title"].forEach(function (a) { pill.removeAttribute(a); });
      pill.querySelectorAll(":scope > .cp-crumb-caret").forEach(function (c) { c.remove(); });
      pill.__cpMenu = null;
    }
    function cpDecorateBoardMenu() {
      var pill = cpBoardMenuPill(), marked = document.querySelector("td.headerBar [data-cp-crumb-menu]"), data = cpReadPageMenu();
      var ready = !!(pill && document.querySelector(".cp-console") && data && data.folders && data.folders.length);
      if (marked && (!ready || marked !== pill)) cpUnmarkBoardMenu(marked);
      if (!ready) return;
      pill.__cpMenu = data;
      if (pill.hasAttribute("data-cp-crumb-menu")) return;
      pill.setAttribute("data-cp-crumb-menu", "");
      pill.setAttribute("role", "button");
      pill.setAttribute("tabindex", "0");
      pill.setAttribute("aria-haspopup", "true");
      pill.setAttribute("aria-expanded", "false");
      pill.title = "All options at this level";
      pill.insertAdjacentHTML("beforeend", CP_CRUMB_CARET);
    }
    function cpToggleBoardMenu(pill) {
      if (document.querySelector(".cp-page-menu")) { cpClosePageMenu(); return; }
      var data = pill.__cpMenu;
      if (!data) return;
      var cons = document.querySelector(".cp-console"), top = cons ? cons.getBoundingClientRect().top : 0, name = "";
      [].slice.call(document.querySelectorAll(".cp-console-section")).some(function (sec) {
        if (sec.getBoundingClientRect().bottom <= top + 8) return false;
        name = ((sec.querySelector(".cp-console-head-name") || {}).textContent || "").trim();
        return true;
      });
      var folder = data.folders.find(function (f) { return f.name === name; }) || data.folders[0];
      cpOpenPageMenu(pill, data, { folder: folder, option: null });
    }
    // Ahead of CommPilot's own handler on a level link, so the pill opens the menu instead of reloading the level.
    document.addEventListener("click", function (e) {
      var pill = e.target.closest && e.target.closest("td.headerBar [data-cp-crumb-menu]");
      if (!pill || e.target.closest(".cp-copy-id")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cpToggleBoardMenu(pill);
    }, true);
    document.addEventListener("keydown", function (e) {
      if ((e.key !== "Enter" && e.key !== " ") || !(e.target.matches && e.target.matches("td.headerBar [data-cp-crumb-menu]"))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cpToggleBoardMenu(e.target);
    }, true);
    // The same rounded folder glyphs used in the sidebar; page-specific header icons take priority.
    var CP_PAGE_FOLDER_ICONS = {
      'profile':'<circle cx="12" cy="8" r="3.25"/><path d="M5.25 20v-1.5A5.25 5.25 0 0 1 10.5 13.25h3A5.25 5.25 0 0 1 18.75 18.5V20"/>',
      'resources':'<rect x="3.25" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13.25" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.25" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.25" y="13.5" width="7.5" height="7.5" rx="2"/>',
      'services':'<path d="m12 2.75 8.25 4.75L12 12.25 3.75 7.5 12 2.75Z"/><path d="m3.75 11.5 8.25 4.75 8.25-4.75M3.75 15.5 12 20.25l8.25-4.75"/>',
      'incoming calls':'<path d="M19.5 5.5h-8v8M11.5 5.5l8 8M4.5 7.5v9a3 3 0 0 0 3 3h9"/>',
      'outgoing calls':'<path d="M12.5 4.5h7v7M19.5 4.5l-8 8M16.5 19.5h-9a3 3 0 0 1-3-3v-9"/>',
      'call control':'<path d="M4.5 6.5h15v11h-15zM8 10h8M8 14h5"/>',
      'calling plans':'<path d="M5 5h5v5H5zM14 14h5v5h-5zM14 5h5v5h-5zM5 14h5v5H5z"/>',
      'client applications':'<rect x="3.5" y="4" width="17" height="15" rx="2.5"/><path d="M3.5 9h17M9 19v2M15 19v2"/>',
      'messaging':'<path d="M4.25 5.25h15.5v11.5H9l-4.75 3v-14.5ZM7.75 9.25h8.5M7.75 12.5h5.75"/>',
      'utilities':'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.25"/><circle cx="15.5" cy="12" r="2.25"/><circle cx="8" cy="18" r="2.25"/>'
    };
    function cpPageMenuIcon(label, folder) {
      var icon = document.createElement('span');
      icon.className = 'cp-page-icon';
      icon.setAttribute('aria-hidden','true');
      var specific = cpHeaderIcon(label);
      var key = (folder || label || '').trim().toLowerCase().replace(/^calling plan$/, 'calling plans');
      var shape = CP_PAGE_FOLDER_ICONS[key] || CP_PAGE_FOLDER_ICONS.resources;
      if (/^call forwarding/i.test(label)) shape = '<path d="M4 4h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 2 6a2 2 0 0 1 2-2ZM14 5h7m-3-3 3 3-3 3"/>';
      else if (/calling (name|number)|line id|identification/i.test(label)) shape = '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16c0-3 6-3 6 0m3-7h4m-4 4h4"/>';
      icon.innerHTML = specific || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + shape + '</svg>';
      return icon;
    }
    function cpOpenPageMenu(pill, data, current) {
      var menu = document.createElement("div");
      menu.className = "cp-page-menu";
      menu.__cpPill = pill;
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", "Pages at this level");
      var tabs = document.createElement("div");
      tabs.className = "cp-page-tabs";
      var cols = document.createElement("div");
      cols.className = "cp-page-cols";
      function show(folder) {
        [].forEach.call(tabs.children, function (t) { t.setAttribute("aria-pressed", String(t.__folder === folder)); });
        cols.textContent = "";
        var groups = [];
        folder.options.forEach(function (o) {
          var g = groups.find(function (x) { return x.name === o.group; });
          if (!g) groups.push(g = { name: o.group, items: [] });
          g.items.push(o);
        });
        groups.forEach(function (g) {
          var col = document.createElement("div");
          var head = document.createElement("div");
          head.className = "cp-page-group";
          head.textContent = g.name;
          col.appendChild(head);
          g.items.forEach(function (o) {
            var item = document.createElement("button");
            item.type = "button";
            item.className = "cp-page-item";
            var itemLabel = document.createElement('span');
            itemLabel.className = 'cp-page-label';
            itemLabel.textContent = o.label;
            item.appendChild(cpPageMenuIcon(o.label,folder.name));
            item.appendChild(itemLabel);
            if (o === current.option) item.setAttribute("aria-current", "page");
            item.addEventListener("click", function () {
              cpClosePageMenu();
              if (o !== current.option) cpHook(o.url, o.params || {});
            });
            col.appendChild(item);
          });
          cols.appendChild(col);
        });
      }
      data.folders.forEach(function (folder) {
        var tab = document.createElement("button");
        tab.type = "button";
        tab.className = "cp-page-tab";
        var tabLabel = document.createElement('span');
        tabLabel.className = 'cp-page-label';
        tabLabel.textContent = folder.name;
        tab.appendChild(cpPageMenuIcon(folder.name));
        tab.appendChild(tabLabel);
        tab.__folder = folder;
        tab.addEventListener("click", function (e) { e.stopPropagation(); show(folder); });
        tabs.appendChild(tab);
      });
      var currentFolder = data.folders.find(function (f) { return f.name === current.folder.name; }) || data.folders[0];
      menu.appendChild(tabs);
      menu.appendChild(cols);
      document.body.appendChild(menu);
      show(currentFolder);
      var r = pill.getBoundingClientRect();
      menu.style.top = Math.round(r.bottom + 8) + "px";
      menu.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - 20) + 'px';
      menu.style.left = Math.round(Math.max(12, Math.min(r.left - 40, document.documentElement.clientWidth - menu.offsetWidth - 12))) + "px";
      pill.setAttribute("aria-expanded", "true");
      setTimeout(function () {
        document.addEventListener("click", cpPageMenuOutside, true);
        document.addEventListener("keydown", cpPageMenuKeys, true);
      }, 0);
      var focus = menu.querySelector('.cp-page-item[aria-current="page"]') || menu.querySelector(".cp-page-item");
      if (focus) focus.focus();
    }

    var cpBoardBuildQueued = false;
    function cpAutoConsole() {
      var cell = document.querySelector('td[width="82%"][valign="top"]');
      var board = cell && cell.querySelector('.cp-console');
      var isFolderMenu = !!(cell && cell.querySelector('a.navMenuItem') &&
        document.querySelector('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen'));
      // A level menu belongs to the trail pill that opened it. A page swap (Back and Forward too) rewrites the header;
      // a board section landing does not. A menu whose pill is gone would open the previous level's pages here.
      var openMenu = document.querySelector(".cp-page-menu");
      if (openMenu && !(openMenu.__cpPill && openMenu.__cpPill.isConnected)) cpClosePageMenu();
      if (board) {
        // A mounted board is still a board while its sections contain only loading placeholders. A second
        // reskin in that interval must not remove the flex layout that makes the console itself scrollable.
        document.documentElement.classList.add('cp-board-active');
        cpWireConsoleScroll();
        try { cpDecorateBoardMenu(); } catch (e) { console.warn("[pjax] board menu", e); }
      } else if (!isFolderMenu) {
        cpReloadEntry = null;   // the reload did not land on a folder menu; later boards need a real entry
        try { cpDecoratePageMenu(); } catch (e) { console.warn("[pjax] page menu", e); }
        if (cpPeekObserver) { cpPeekObserver.disconnect(); cpPeekObserver = null; }
        document.documentElement.classList.remove("cp-board-active");
        if (cpPopScroll !== null && cell) {
          var restoreTop = cpPopScroll;
          cpPopScroll = null;
          requestAnimationFrame(function () { cell.scrollTop = restoreTop; });
        }
      } else {
        // cpHook's fetched page schedules its own DOMContentLoaded wiring in
        // microtasks. Let those handlers finish against the native menu before
        // replacing it with the board; its copied links are then wired once.
        if (!cpBoardBuildQueued) {
          cpBoardBuildQueued = true;
          Promise.resolve().then(function () {
            cpBoardBuildQueued = false;
            if (cell.isConnected && cell.querySelector('a.navMenuItem') && !cell.querySelector('.cp-console')) {
              cpBuildConsole();
              try { cpDecorateBoardMenu(); } catch (e) { console.warn("[pjax] board menu", e); }   // a level read through before
            }
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
      var a = e.target.closest && e.target.closest('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen');
      if (!a) return;
      // A sidebar swapped in by a level change has no stamps until a board is built for it, and CommPilot's own
      // listeners on it are not always re-attached: read the folder from the link itself, so the click always goes.
      var tgt = cpFolderTarget(a);
      var fid = tgt && tgt.folder;
      if (!fid) return;
      // Back restores its saved scroll only after the menu finishes revealing. A newer sidebar choice
      // takes precedence, including a click made while those sections are still loading.
      cpPopScroll = null;
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
      // While the board is still revealing its sections one at a time, the picked one may not be shown yet:
      // a display:none section measures as nothing, so the scroll went nowhere (the folder lit up, the page
      // stayed). Show it now, start its load, and pin it at the top while the sections above it fill in.
      var filling = cpRevealBusy || sec.dataset.cpRevealed !== "1" || !!sec.style.visibility;
      // Peek can finish after this click. Its alignment belongs to the newest target, not the section
      // selected when the board opened; writing that old position cancels the browser's smooth scroll.
      cpJumpAnchorSec = sec;
      if (filling) {
        cpUserPin = sec;
        if (sec.dataset.cpRevealed !== "1") cpRevealSection(sec, false);
        sec.style.display = "";
        sec.style.visibility = "";
        cpLoadAndRevealSection(sec, false, null, null);   // no-op if it is loaded or on its way
      }
      // Measure the section at its resting position, not partway through its 10px entrance animation.
      if (sec.getAnimations) sec.getAnimations().forEach(function (animation) { animation.finish(); });
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
        // Instant while filling in: the pin re-aligns as sections above appear, which a smooth scroll would fight.
        cons.scrollTo({ top: target, behavior: filling ? 'auto' : 'smooth' });
      }
      cpHighlightFolder(fid);   // instant highlight; spy stays suppressed until the scroll settles
    }, true);
  }
})();
