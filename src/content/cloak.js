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
