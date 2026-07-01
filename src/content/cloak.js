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
  // Per-property CSSOM, not setAttribute("style") — the page CSP (style-src 'nonce-…') blocks inline style
  // ATTRIBUTES but not CSSOM property writes, so the splash actually paints (anti-FOUC). See skin.js note.
  o.style.position = "fixed"; o.style.inset = "0"; o.style.zIndex = "2147483647"; o.style.background = "#1c1b19";
  o.style.display = "flex"; o.style.alignItems = "center"; o.style.justifyContent = "center";
  o.style.font = "600 14px/1.4 'Nunito','Segoe UI',system-ui,sans-serif"; o.style.color = "#6b6862";
  // During a user-initiated sign-out (skin.js sets cp-signing-out on confirm),
  // paint the SAME "Signing out…" spinner the dialog morphed into, so the wait
  // reads as one continuous branded screen across the logout→login hops instead
  // of the generic wordmark. The 15s window bounds a stale flag. Styles +
  // spin live in skin.css (.cp-signout-*). KEEP IN SYNC with skin.js
  // cpSignOutSplashHTML().
  var signingOut = false;
  try {
    var _so = parseInt(sessionStorage.getItem("cp-signing-out") || "0", 10);
    signingOut = !!_so && (Date.now() - _so < 15000);
  } catch (e) {}
  if (signingOut) {
    // Rendered as a CARD (.cp-signout-card) — not a bare full-screen spinner —
    // matching the console sign-out card for visual continuity. skin.js's
    // cpRevealCloak fades this cloak out / the login card in on arrival.
    o.innerHTML =
      '<div class="cp-signout-card">' +
        '<div class="cp-signout-body">' +
          '<div class="cp-signout-ring">' +
            '<div class="cp-signout-spin">' +
              '<svg viewBox="0 0 76 76" aria-hidden="true">' +
                '<circle class="cp-signout-track" cx="38" cy="38" r="31"></circle>' +
                '<circle class="cp-signout-arc" cx="38" cy="38" r="31"></circle>' +
              '</svg>' +
            '</div>' +
            '<span class="cp-signout-ico" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
            '</span>' +
          '</div>' +
          '<p class="cp-signout-cap">Signing out…</p>' +
          '<p class="cp-signout-sub">Ending your session</p>' +
        '</div>' +
      '</div>';
    // Continue the spin from where it was on the previous document (the flag
    // value is the confirm timestamp), so the ring doesn't snap back to the top
    // when it reappears here — one continuous rotation across the hop. 0.9s = the
    // .cp-signout-spin period in skin.css.
    try {
      var _spin = o.querySelector(".cp-signout-spin");
      if (_spin) _spin.style.animationDelay = "-" + ((Date.now() - _so) % 900) + "ms";
    } catch (e) {}
  } else {
    o.textContent = "CommPilot";
  }
  root.appendChild(o);

  // Answer stubguard.js (MAIN world) when it needs the saved navigation
  // and — critically — the saved formtokenserial from chrome.storage. The
  // token inside an unauthorized GET-stub is a login-context token the
  // server rejects for app POSTs; only a token harvested from a real
  // logged-in page works for the replay.
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || !e.data.__cpStubNavQuery) return;
    try {
      // PER-ORIGIN keys — chrome.storage.local is shared across hosts, so a bare key let one host recover
      // another host's nav/token (apps01 replayed the sandbox's URL → cross-host /Login/). Read only THIS host's.
      var navKey = "cpRecoverNav:" + location.origin, tokKey = "cpRecoverToken:" + location.origin;
      chrome.storage.local.get([navKey, tokKey], function (d) {
        try {
          window.postMessage(
            { __cpStubNavReply: { nav: (d && d[navKey]) || null, token: (d && d[tokKey]) || null } },
            location.origin
          );
        } catch (err) {}
      });
    } catch (err) {
      try { window.postMessage({ __cpStubNavReply: { nav: null, token: null } }, location.origin); } catch (e2) {}
    }
  });
})();
