(function () {
  try { history.replaceState(history.state || {}, "", location.href); } catch (e) {}

  var onLogin =
    location.pathname.indexOf("/Login/") !== -1 ||
    !!document.querySelector('input[name="password"]');
  try {
    if (onLogin && sessionStorage.getItem("cp-last-nav"))
      sessionStorage.setItem("cp-pending-return", "1");
  } catch (e) {}

  if (typeof window.redirectPost !== "function") return;

  // Harvest the live CSP nonce once
  var LIVE_NONCE = "";
  var ss = document.scripts;
  for (var i = 0; i < ss.length; i++) {
    if (ss[i].nonce) {
      LIVE_NONCE = ss[i].nonce;
      break;
    }
  }

  var cpSeq = 0;

  var _orig = window.redirectPost;

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

  function isPjaxUrl(u) {
    return (
      typeof u === "string" &&
      (u.indexOf("folder_contents.jsp") !== -1 ||
        /\/commpilot\/Reseller\/[A-Za-z]+\/(index\.jsp)?$/.test(u))
    );
  }

  function cpHook(url, params) {
    try {
      if (isPjaxUrl(url)) {
        var mySeq = ++cpSeq;
        try { if (params && String(params.menuId) === "8") sessionStorage.setItem("cp-last-nav", JSON.stringify({ url: url, params: params })); } catch (e) {}
        var body = new URLSearchParams();
        for (var key in params) {
          if (Object.prototype.hasOwnProperty.call(params, key)) {
            body.append(key, params[key]);
          }
        }
        var tok = document.getElementsByName("formtokenserial")[0];
        if (tok) body.append("formtokenserial", tok.value);

        console.log("[pjax] fetching", url, body.toString());
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          credentials: "same-origin"
        })
          .then(function (r) {
            console.log("[pjax] response", r.status, r.url);
            return r.text();
          })
          .then(function (html) {
            if (mySeq !== cpSeq) {
              console.log("[pjax] superseded — dropping stale swap");
              return;
            }
            var doc = new DOMParser().parseFromString(html, "text/html");

            // Auth-failure guard
            if (
              html.indexOf("Please login again") !== -1 ||
              html.indexOf("not authorized to access the system") !== -1
            ) {
              console.warn("[pjax] auth/session failure — real navigation fallback");
              _orig.call(window, url, params);
              return;
            }

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
            var n = reexecScripts(liveCell);
            document.addEventListener = origAdd;
            if (window.redirectPost !== cpHook) { _orig = window.redirectPost; window.redirectPost = cpHook; }
            console.log("[pjax] re-executed", n, "scripts");
            document.dispatchEvent(new CustomEvent("cp:reskin"));
            console.log("[pjax] reskin dispatched");
            try { history.replaceState(history.state || {}, "", url); } catch (e) {}
          })
          .catch(function (e) {
            console.warn("[pjax] fetch FAILED", e);
          });

        return; // do NOT call _orig — no navigation for menu navs
      }
    } catch (e) {}
    return _orig.apply(this, arguments);
  }

  window.redirectPost = cpHook;

  document.addEventListener("submit", function (e) {
    try {
      var form = e.target;
      if (!form || form.tagName !== "FORM") return;
      if (!isPjaxUrl(form.action || "")) return;
      e.preventDefault();
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
})();
