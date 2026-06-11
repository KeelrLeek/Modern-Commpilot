// Full-load splash cloak — injected at document_start so the very first
// frame the browser paints is already dark and contentful (text forces an
// early first-contentful-paint, which is what ends the browser's own
// grey/white pre-paint background). It covers the raw legacy layout while
// it loads; skin.js fades this overlay out and removes it once the page
// is fully restructured (skin.css carries a 1.2s failsafe fade in case
// skin.js never runs).
(function () {
  if (window !== window.top) return;
  var root = document.documentElement;
  if (!root || document.getElementById("cp-cloak")) return;
  var o = document.createElement("div");
  o.id = "cp-cloak";
  o.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:2147483647;background:#1c1b19;" +
      "display:flex;align-items:center;justify-content:center;" +
      "font:600 14px/1.4 'Nunito','Segoe UI',system-ui,sans-serif;color:#6b6862;"
  );
  o.textContent = "CommPilot";
  root.appendChild(o);

  // TEMP DIAGNOSTICS — white-flash flight recorder. For every document,
  // log when this script ran vs when the browser first painted, plus
  // server latency, into a rolling chrome.storage log (cpFlashLog).
  // fp < t0 ⇒ the raw page painted before the cloak (injection race).
  // Large respStart ⇒ long inter-document gap where the browser may show
  // its own (white) background. Remove once the flash is solved.
  try {
    var rec = {
      stamp: Date.now(),
      path: location.pathname,
      t0: Math.round(performance.now()),
      fp: null,
      fcp: null,
      nav: null
    };
    var saveRec = function () {
      try {
        var n = performance.getEntriesByType("navigation")[0];
        if (n) {
          rec.nav = {
            respStart: Math.round(n.responseStart),
            respEnd: Math.round(n.responseEnd),
            dcl: Math.round(n.domContentLoadedEventStart)
          };
        }
        chrome.storage.local.get("cpFlashLog", function (d) {
          try {
            var log = (d && d.cpFlashLog) || [];
            var i = log.findIndex(function (r) { return r.stamp === rec.stamp; });
            if (i === -1) log.push(rec); else log[i] = rec;
            while (log.length > 30) log.shift();
            chrome.storage.local.set({ cpFlashLog: log });
          } catch (e) {}
        });
      } catch (e) {}
    };
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (en) {
          if (en.name === "first-paint") rec.fp = Math.round(en.startTime);
          if (en.name === "first-contentful-paint") rec.fcp = Math.round(en.startTime);
        });
        saveRec();
      }).observe({ type: "paint", buffered: true });
    } catch (e) {}
    saveRec();
    setTimeout(saveRec, 2000);
  } catch (e) {}

  // Answer the flash-log dump query (diagnostics, page world asks for it).
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || !e.data.__cpFlashLogQuery) return;
    try {
      chrome.storage.local.get("cpFlashLog", function (d) {
        try { window.postMessage({ __cpFlashLogReply: (d && d.cpFlashLog) || [] }, location.origin); } catch (err) {}
      });
    } catch (err) {}
  });

  // Answer stubguard.js (MAIN world) when it needs the saved navigation
  // and — critically — the saved formtokenserial from chrome.storage. The
  // token inside an unauthorized GET-stub is a login-context token the
  // server rejects for app POSTs; only a token harvested from a real
  // logged-in page works for the replay.
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || !e.data.__cpStubNavQuery) return;
    try {
      chrome.storage.local.get(["cpRecoverNav", "cpRecoverToken"], function (d) {
        try {
          window.postMessage(
            { __cpStubNavReply: { nav: (d && d.cpRecoverNav) || null, token: (d && d.cpRecoverToken) || null } },
            location.origin
          );
        } catch (err) {}
      });
    } catch (err) {
      try { window.postMessage({ __cpStubNavReply: { nav: null, token: null } }, location.origin); } catch (e2) {}
    }
  });
})();
