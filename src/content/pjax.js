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
                  document.querySelectorAll('form[name="leftNavForm"] a').forEach(function (la) {
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
        var fm = /folder\s*:\s*['"](R\d+)['"]/i.exec(onclick);
        if (fm) folder = fm[1];
        var mm = /menuId\s*:\s*['"](\d+)['"]/i.exec(onclick);
        if (mm) menuId = mm[1];
        if (!folder) {
          var el = a;
          for (var hop = 0; hop < 4 && el; hop++) {
            var scripts = el.querySelectorAll("script");
            for (var si = 0; si < scripts.length; si++) {
              var txt = scripts[si].textContent || "";
              var fm2 = /folder['"\s:,]+(R\d+)/.exec(txt);
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
        var head = document.createElement("div");
        head.className = "cp-console-head";
        var headName = document.createElement("span");
        headName.className = "cp-console-head-name";
        headName.textContent = f.name;
        var headCount = document.createElement("span");
        headCount.className = "cp-console-count";
        headCount.hidden = true;
        head.appendChild(headName);
        head.appendChild(headCount);
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
      // IntersectionObserver
      cpConsoleObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var bodyEl = entry.target;
          if (bodyEl.dataset.cpRequested === "1" || bodyEl.getAttribute("data-cp-loaded") === "1" || !document.querySelector(".cp-console")) return;
          bodyEl.dataset.cpRequested = "1";
          var sec = bodyEl.closest(".cp-console-section");
          var folder = sec ? sec.getAttribute("data-cp-folder") : "";
          var mId = "8";
          for (var fi = 0; fi < folders.length; fi++) { if (folders[fi].folder === folder) { mId = folders[fi].menuId; break; } }
          cpFetchSection(folder, mId).then(function (html) {
            if (cpSectionAborted || !document.querySelector(".cp-console")) return;
            if (html) {
              bodyEl.innerHTML = html;
              bodyEl.setAttribute("data-cp-loaded", "1");
              document.dispatchEvent(new Event("cp:reskin"));
              cpReexecWiringScripts(bodyEl);
              cpSetSectionCount(bodyEl);
              cpSummarizeLeaves(bodyEl);
            } else {
              delete bodyEl.dataset.cpRequested;
              bodyEl.innerHTML = "";
              var retryBtn = document.createElement("button");
              retryBtn.textContent = "Couldn\u2019t load \u2014 Retry";
              retryBtn.style.cssText = "background:none;border:1px solid var(--cp-border, #3c3a37);border-radius:6px;padding:6px 14px;color:var(--cp-text, #e8e8e8);cursor:pointer;font:inherit;";
              retryBtn.addEventListener("click", function () {
                delete bodyEl.dataset.cpRequested;
                bodyEl.innerHTML = "";
                var ld = document.createElement("div");
                ld.className = "cp-console-loading";
                ld.textContent = "Loading\u2026";
                bodyEl.appendChild(ld);
                bodyEl.dataset.cpRequested = "1";
                cpFetchSection(folder, mId).then(function (html2) {
                  if (cpSectionAborted || !document.querySelector(".cp-console")) return;
                  if (html2) { bodyEl.innerHTML = html2; bodyEl.setAttribute("data-cp-loaded", "1"); document.dispatchEvent(new Event("cp:reskin")); cpReexecWiringScripts(bodyEl); cpSetSectionCount(bodyEl); cpSummarizeLeaves(bodyEl); }
                  else { delete bodyEl.dataset.cpRequested; bodyEl.innerHTML = ""; bodyEl.appendChild(retryBtn); }
                });
              });
              bodyEl.appendChild(retryBtn);
            }
          });
        });
      }, { rootMargin: "400px" });
      consoleDiv.querySelectorAll(".cp-console-body").forEach(function (bodyEl) {
        cpConsoleObserver.observe(bodyEl);
      });
      cpSyncConsoleClass();
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
      if (!cell || !cell.querySelector('a.navMenuItem')) return;
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
      if (!document.querySelector('.cp-console')) return;
      var fid = a.getAttribute('data-cp-folder');
      if (!fid) return;
      var sec = document.querySelector('.cp-console-section[data-cp-folder="' + fid + '"]');
      if (!sec) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // sync the sidebar active highlight to the clicked folder
      document.querySelectorAll('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen').forEach(function (o) {
        o.classList.remove('leftnavfolderopen'); o.classList.add('leftnavfolder');
      });
      a.classList.remove('leftnavfolder'); a.classList.add('leftnavfolderopen');
    }, true);
  }
})();
