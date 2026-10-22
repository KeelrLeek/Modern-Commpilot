/* Confirm the native header sign-out without replacing CommPilot's logout action. */
(() => {
  "use strict";

  if (window !== window.top || window.__cpNativeLogoutConfirmBound) return;
  window.__cpNativeLogoutConfirmBound = true;

  const FLAG = "cp-signing-out";
  const OVERLAY = "cp-native-logout-overlay";
  let passingNativeClick = false;
  let active = null;

  // A previous interrupted sign-out must never affect another PJAX action.
  try { sessionStorage.removeItem(FLAG); } catch (_) {}
  // A direct native logout (for example when PJAX is unavailable) still skips
  // CommPilot's redundant two-link landing after its response loads.
  if (/^\/commpilot\/(?:servlet\/Logout|Logout)(?:\/|$)/i.test(location.pathname)) {
    location.replace("/commpilot/Login/");
    return;
  }

  function isLogoutLink(link) {
    if (!(link instanceof HTMLAnchorElement) || !link.matches("a.headerLink")) return false;
    const cell = link.closest("td.headerBar");
    if (!cell || !cell.querySelector(".headerBarWelcome")) return false;
    return /^(?:\[\s*)?(?:log\s*out|sign\s*out)(?:\s*\])?$/i.test(link.textContent.trim());
  }

  function closeModal() {
    if (!active || active.signingOut) return;
    const { overlay, trigger, keyHandler } = active;
    document.removeEventListener("keydown", keyHandler, true);
    overlay.remove();
    active = null;
    if (trigger.isConnected) trigger.focus();
  }

  function confirmLogout() {
    if (!active || active.signingOut) return;
    active.signingOut = true;
    const { trigger, overlay, keyHandler } = active;
    document.removeEventListener("keydown", keyHandler, true);
    const dialog = overlay.querySelector(".cp-native-logout-dialog");
    dialog.setAttribute("aria-busy", "true");
    overlay.querySelector(".cp-native-logout-title").textContent = "Signing out…";
    overlay.querySelector(".cp-native-logout-copy").textContent = "Ending your CommPilot session.";
    overlay.querySelector(".cp-native-logout-actions").hidden = true;

    // The existing native handler synchronously calls redirectPost. PJAX sees
    // this flag, sends the same logout POST, then goes directly to Login.
    // Clear it immediately after that call so an unrelated later action cannot
    // be mistaken for logout if the navigation is interrupted.
    // Storage is an optimization hint for PJAX, not a prerequisite for the user's native sign-out.
    try { sessionStorage.setItem(FLAG, String(Date.now())); } catch (_) {}
    try {
      passingNativeClick = true;
      trigger.click();
    } finally {
      passingNativeClick = false;
      try { sessionStorage.removeItem(FLAG); } catch (_) {}
    }
  }

  document.addEventListener("cp:logout-failed", (event) => {
    if (!active || !active.signingOut) return;
    let message = "The request could not be completed.";
    try {
      const detail = JSON.parse(event.detail);
      if (typeof detail?.message === "string") message = detail.message;
    } catch (_) {}
    const { overlay, keyHandler } = active;
    active.signingOut = false;
    overlay.querySelector(".cp-native-logout-dialog").removeAttribute("aria-busy");
    overlay.querySelector(".cp-native-logout-title").textContent = "Sign-out not confirmed";
    overlay.querySelector(".cp-native-logout-copy").textContent =
      `${message} Sign-out was not confirmed. Retry to end your session.`;
    overlay.querySelector(".cp-native-logout-actions").hidden = false;
    overlay.querySelector(".cp-native-logout-cancel").textContent = "Close";
    const retry = overlay.querySelector(".cp-native-logout-confirm");
    retry.textContent = "Retry sign out";
    document.addEventListener("keydown", keyHandler, true);
    retry.focus();
  });

  function showModal(trigger) {
    if (active) return;
    const overlay = document.createElement("div");
    overlay.className = `${OVERLAY} cp-logout-overlay`;
    overlay.innerHTML =
      '<section class="cp-native-logout-dialog" role="dialog" aria-modal="true" ' +
        'aria-labelledby="cp-native-logout-title" aria-describedby="cp-native-logout-copy">' +
        '<span class="cp-native-logout-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M9 4.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3"/>' +
            '<path d="m14 8 4 4-4 4M9 12h9"/>' +
          '</svg>' +
        '</span>' +
        '<h2 class="cp-native-logout-title" id="cp-native-logout-title">Sign out of CommPilot?</h2>' +
        '<p class="cp-native-logout-copy" id="cp-native-logout-copy">Your session will end and you’ll return to the sign-in page.</p>' +
        '<div class="cp-native-logout-actions">' +
          '<button type="button" class="cp-native-logout-cancel">Stay here</button>' +
          '<button type="button" class="cp-native-logout-confirm">Sign out</button>' +
        '</div>' +
      '</section>';

    const keyHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...overlay.querySelectorAll("button:not([disabled])")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    active = { overlay, trigger, keyHandler, signingOut: false };
    overlay.querySelector(".cp-native-logout-cancel").addEventListener("click", closeModal);
    overlay.querySelector(".cp-native-logout-confirm").addEventListener("click", confirmLogout);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(); });
    document.body.append(overlay);
    document.addEventListener("keydown", keyHandler, true);
    overlay.querySelector(".cp-native-logout-cancel").focus();
  }

  document.addEventListener("click", (event) => {
    if (passingNativeClick || document.body?.id !== "initBody.menuTemplate") return;
    const target = event.target instanceof Element ? event.target.closest("a.headerLink") : null;
    if (!isLogoutLink(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showModal(target);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (passingNativeClick || active || document.body?.id !== "initBody.menuTemplate") return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const link = event.target;
    if (!isLogoutLink(link)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showModal(link);
  }, true);

  function makeLinkKeyboardAccessible() {
    if (document.body?.id !== "initBody.menuTemplate") return;
    for (const link of document.querySelectorAll("td.headerBar a.headerLink")) {
      if (!isLogoutLink(link)) continue;
      if (!link.hasAttribute("tabindex")) link.tabIndex = 0;
      link.setAttribute("role", "button");
      link.setAttribute("aria-haspopup", "dialog");
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", makeLinkKeyboardAccessible, { once: true });
  } else makeLinkKeyboardAccessible();
  document.addEventListener("cp:morphed", () => requestAnimationFrame(makeLinkKeyboardAccessible));
  document.addEventListener("cp:reskin", () => requestAnimationFrame(makeLinkKeyboardAccessible));
})();
