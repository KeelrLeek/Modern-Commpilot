(function () {
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

    cpHook = function (url, params) {
      try {
        if (isPjaxUrl(url)) {
          var mySeq = ++cpSeq;
          try { cpLastNav = { url: url, params: params || {} }; } catch (e) {}
          try { if (url.indexOf("/Common/page.jsp") === -1 && url.indexOf("/Common/sort.jsp") === -1) { var _nav = { url: url, params: params || {} }; sessionStorage.setItem("cp-last-nav", JSON.stringify(_nav)); window.postMessage({ __cpRecoverNav: _nav }, location.origin); } } catch (e) {}
          var liveTokEl = document.getElementsByName("formtokenserial")[0];
          console.log("[pjax] fetching", url);
          cpFollow(url, params, liveTokEl ? liveTokEl.value : null, 0)
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

              // Update tab title from fetched page
              try { if (doc.title) document.title = doc.title; } catch (e) {}

              // Restore breadcrumb above swapped title
              try {
                var fCrumbLink = doc.querySelector('td.headerBar a.headerAuthLevelLink');
                var newTitle = liveCell.querySelector("td.screenName");
                if (fCrumbLink && newTitle) {
                  var fCell = fCrumbLink.closest("td");
                  var titleTable = newTitle.closest("table");
                  var bar = document.createElement("div");
                  bar.className = "cp-breadcrumb";
                  Array.prototype.slice.call(fCell.childNodes).forEach(function (n) {
                    if (n.nodeType === 1 && (n.tagName === "IMG" || n.tagName === "SCRIPT")) return;
                    bar.appendChild(document.importNode(n, true));
                  });
                  bar.querySelectorAll("a.headerAuthLevelLink").forEach(function (a) {
                    a.style.cursor = "pointer";
                    a.addEventListener("click", function () {
                      window.redirectPost("/commpilot/Common/folder_contents.jsp", { folder: "R0", menuId: "8" });
                    });
                  });
                  if (titleTable && titleTable.parentNode) titleTable.parentNode.insertBefore(bar, titleTable);
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
      var nav = cpLastNav || { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
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
              var fm2 = /folder['"\s:,]+([A-Z]\d+)/.exec(txt);
              if (fm2) { folder = fm2[1]; break; }
              var mm2 = /menuId['"\s:,]+(\d+)/.exec(txt);
              if (mm2) menuId = mm2[1];
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
      // LEVEL GATE: the aggregated one-scroll console currently only works at the RESELLER level.
      // Folder ENUMERATION is level-general (the regex above matches R/S/… ids), but deeper levels
      // (Service Provider S-ids, and Group/User) return content-less SHELLS to the out-of-band
      // folder_contents.jsp fetch — that endpoint renders a folder's menu only to a real top-level
      // navigation there, never to an XHR. So aggregating them would show empty sections. Until a
      // per-level fetch model is implemented, build only for reseller (R-scheme) folders; other
      // levels keep their native menu inside the floating shell (cpSyncConsoleClass still applies it).
      if (!folders.every(function (f) { return /^R\d+$/.test(f.folder); })) return;
      // Build console DOM
      var consoleDiv = document.createElement("div");
      consoleDiv.className = "cp-console";
      // Breadcrumb header — built here, inserted into the content cell ABOVE .cp-console
      // (below) so it stays pinned while the console scrolls internally.
      var crumb = document.createElement("div");
      crumb.className = "cp-breadcrumb";
      var crumbSeg = document.createElement("a");
      crumbSeg.textContent = "Reseller";
      crumb.appendChild(crumbSeg);
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
      while (contentCell.firstChild) contentCell.removeChild(contentCell.firstChild);
      contentCell.appendChild(crumb);
      contentCell.appendChild(consoleDiv);
      // Sequential-expand reveal (Option A): every section starts HIDDEN, then they reveal one at a
      // time top-down from the anchor (the jumped-to folder, else Profile at the top) as each loads —
      // each section slides in and cascades its cards (staggerCards), so the console grows downward
      // and the load is masked. cpStartRevealSequence owns the load order; the old IntersectionObserver
      // lazy-load is retired (all 6 reseller sections load per build regardless).
      consoleDiv.querySelectorAll(".cp-console-section").forEach(function (s) { s.style.display = "none"; });
      cpSyncConsoleClass();
      cpWireConsoleScroll();
      cpEnsureSubmenuScaffold();
      cpHeadFade();
      cpStartRevealSequence(cpPendingFolder);
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
      if (!bodyEl || !document.querySelector(".cp-console")) { if (done) done(); return; }
      if (bodyEl.getAttribute("data-cp-loaded") === "1" || bodyEl.dataset.cpRequested === "1") { if (done) done(); return; }
      bodyEl.dataset.cpRequested = "1";
      var folder = sec.getAttribute("data-cp-folder");
      var mId = sec.getAttribute("data-cp-menuid") || "8";
      cpFetchSection(folder, mId).then(function (html) {
        if (cpSectionAborted || !sec || !document.contains(sec) || !document.querySelector(".cp-console")) { if (done) done(); return; }
        if (html) {
          bodyEl.innerHTML = html;
          bodyEl.setAttribute("data-cp-loaded", "1");
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
      if (cpSectionAborted || !document.querySelector(".cp-console")) { cpRevealBusy = false; return; }
      if (i >= order.length) {
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
      cpBuildConsole();   // no-ops at non-reseller levels (its R0–R5 regex finds no folders)
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
