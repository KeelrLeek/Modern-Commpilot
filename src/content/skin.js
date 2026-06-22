console.log("[Modern CommPilot Skin] content script loaded");

function cpSaveRecoverToken(resetTries) {
  try {
    if (location.pathname.indexOf("/Login/") !== -1 || document.querySelector('input[type=password]')) return;
    // Contentless redirect-stub pages carry a login-context token the server
    // rejects for app POSTs — saving it would poison the recovery store.
    if (!document.querySelector('td[width="82%"], a.navMenuItem, .navOptions')) return;
    var t = document.getElementsByName("formtokenserial")[0];
    if (t && t.value && chrome.storage) {
      var o = { cpRecoverToken: t.value };
      if (resetTries) o.cpRecoverTries = 0;
      chrome.storage.local.set(o);
    }
  } catch (e) {}
}
cpSaveRecoverToken(true);
document.addEventListener("cp:reskin", function () { cpSaveRecoverToken(false); });
setInterval(function () { cpSaveRecoverToken(false); }, 15000);

window.addEventListener("message", function (e) {
  try {
    if (e.source === window && e.data && e.data.__cpRecoverNav && chrome.storage) {
      chrome.storage.local.set({ cpRecoverNav: e.data.__cpRecoverNav });
    }
  } catch (err) {}
});

/*
 * Inject asset-backed CSS rules at runtime.
 *
 * Relative url() paths inside content-script CSS resolve against the PAGE
 * origin (apps01.avpaas.io), not the extension, so they 404 against the
 * site's server. chrome.runtime.getURL() builds absolute chrome-extension://
 * URLs that load correctly and are exempt from the page's CSP (the files are
 * declared in web_accessible_resources).
 */
(function injectAssetCss() {
  if (document.getElementById("cp-skin-assets")) return;
  const url = (p) => chrome.runtime.getURL(p);

  // Folder glyphs, one palette for the sidebar AND the console section headers. The SIDEBAR icon is
  // keyed by data-cp-icon — a NAME-derived key skin.js stamps on each folder (tagSidebarIcons) — NOT
  // by row position. Positional (tr:nth-child) keying broke at the Service-Provider level: its 5
  // folders (Profile / Resources / Services / Communication Barring / Utilities) sit in different
  // rows than reseller's 6, so rows 5/6 reused the call-center / meet-me glyphs. Name-keying is
  // level-agnostic and is applied at document_end, so there's no glyph-less flash.
  const iconFile = {
    profile: "assets/icons/profile.svg",
    resources: "assets/icons/resources.svg",
    services: "assets/icons/services.svg",
    callcenter: "assets/icons/callcenter.svg",
    meetme: "assets/icons/meetme.svg",
    utilities: "assets/icons/utilities.svg",
    "comm-barring": "assets/icons/comm-barring.svg",
    callingplan: "assets/icons/calling-plan.svg",
    "incoming-calls": "assets/icons/incoming-calls.svg",
    "outgoing-calls": "assets/icons/outgoing-calls.svg",
    "call-control": "assets/icons/call-control.svg",
    messaging: "assets/icons/messaging.svg",
    "client-apps": "assets/icons/client-apps.svg",
    unknown: "assets/icons/unknown.svg",
  };

  let css = "";

  for (const [key, path] of Object.entries(iconFile)) {
    css += `
form[name="leftNavForm"] a[data-cp-icon="${key}"]::before {
  -webkit-mask-image: url("${url(path)}") !important;
  mask-image: url("${url(path)}") !important;
}`;
  }

  // Console section-header icons reuse the same glyphs on each .cp-console-head-ico, keyed by the same
  // name-derived data-cp-icon that tagSidebarIcons stamps — so SP/Group/User sections key correctly
  // too, not just reseller R0..R5. Recoloured to the accent via background-color in skin.css.
  for (const [key, path] of Object.entries(iconFile)) {
    css += `
.cp-console-head-ico[data-cp-icon="${key}"] {
  -webkit-mask-image: url("${url(path)}") !important;
  mask-image: url("${url(path)}") !important;
}`;
  }
  // Until a glyph is stamped, stay transparent rather than flash a solid colour box.
  css += `
form[name="leftNavForm"] a.leftnavfolder:not([data-cp-icon])::before,
form[name="leftNavForm"] a.leftnavfolderopen:not([data-cp-icon])::before,
.cp-console-head-ico:not([data-cp-icon]) { background-color: transparent !important; }`;

  // Footer icon background-images (injected early so they're ready when
  // moveHeaderLinks moves the <a> nodes and adds data-cp-icon attributes).
  const footerIcons = [
    { icon: "help", path: "assets/icons/help.svg" },
    { icon: "home", path: "assets/icons/home.svg" },
    { icon: "logout", path: "assets/icons/logout.svg" },
  ];
  for (const { icon, path } of footerIcons) {
    css += `
.cp-footer-btn[data-cp-icon="${icon}"]::before {
  -webkit-mask-image: url("${url(path)}") !important;
  mask-image: url("${url(path)}") !important;
}`;
  }

  /* Sort direction icons */
  css += `
.cp-sort-asc { background-image: url("${url("assets/icons/sort-asc.svg")}") !important; }
.cp-sort-desc { background-image: url("${url("assets/icons/sort-desc.svg")}") !important; }
a.listSortHeader:not(:has(.cp-sort-ico))::after { background-image: url("${url("assets/icons/sort-desc.svg")}") !important; }
.cp-dd-chevron { background-image: url("${url("assets/icons/sort-desc.svg")}") !important; }`;

  /* Plus / minus icons on add/delete-row buttons.
     Targeted by [value] so dynamically-created buttons from addRow()
     (add1/add2/del1/del2) are automatically styled. */
  css += `
input.bwbutton[value="+"] { background-image: url("${url("assets/icons/plus.svg")}") !important; }
input.bwbutton[value="-"] { background-image: url("${url("assets/icons/minus.svg")}") !important; }`;

  /* Pagination icon buttons */
  const pageIcons = [
    { dir: "first", path: "assets/icons/page-first.svg" },
    { dir: "prev",   path: "assets/icons/page-prev.svg" },
    { dir: "next",   path: "assets/icons/page-next.svg" },
    { dir: "last",   path: "assets/icons/page-last.svg" },
  ];
  for (const { dir, path } of pageIcons) {
    css += `
.cp-page-btn[data-cp-page="${dir}"] { background-image: url("${url(path)}") !important; }`;
  }

  css += `
.cp-breadcrumb a + a::before { background-image: url("${url("assets/icons/chevron.svg")}") !important; }`;

  const style = document.createElement("style");
  style.id = "cp-skin-assets";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();

/*
 * Wrap each nav menu item (link + description) into a glass card.
 *
 * Each .navMenuItem anchor lives inside a <td> in a <tr> within the
 * two-column content table (td[width="50%"]).  The description sits
 * in the immediately following <tr>.
 *
 * Instead of replacing the <tr> (invalid — a <div> cannot replace a
 * <tr> inside <tbody>), we build the card *inside* the existing <td>,
 * move the <a> node into it (preserving id + event listeners), and
 * empty the orphaned description <tr> rather than removing it.
 * Each item is wrapped in try/catch so a single surprise can't blank
 * the page.
 */
function wrapMenuCards() {
  const anchors = document.querySelectorAll("a.navMenuItem");

  anchors.forEach((anchor) => {
    try {
      if (anchor.closest(".cp-menu-card")) return;

      const linkTr = anchor.closest("tr");
      if (!linkTr) return;

      const linkTd = linkTr.querySelector("td");
      if (!linkTd) return;

      const descTr = linkTr.nextElementSibling;
      if (!descTr || descTr.tagName !== "TR") return;

      const descTd = descTr.querySelector("td");
      if (!descTd || descTd.querySelector("a")) return;

      const card = document.createElement("div");
      card.className = "cp-menu-card";

      const titleWrap = document.createElement("div");
      titleWrap.className = "cp-card-title";
      titleWrap.appendChild(anchor);

      const descWrap = document.createElement("div");
      descWrap.className = "cp-card-desc";
      descWrap.textContent = descTd.textContent;

      card.appendChild(titleWrap);
      card.appendChild(descWrap);

      linkTd.appendChild(card);

      descTd.textContent = "";
    } catch (e) {
      console.warn("[CommPilot Skin] wrapMenuCards: skipping item", e);
    }
  });
  document.querySelectorAll(".cp-console-body:not([data-cp-menu-done])").forEach(function (b) {
    b.setAttribute("data-cp-menu-done", "1");
  });
}

function tagMenuColumns() {
  document.querySelectorAll("td.menuCategory").forEach(function (mc) {
    try {
      var t = mc.closest("table");
      var col = t && t.parentElement;
      if (col && col.tagName === "TD") col.classList.add("cp-menu-col");
    } catch (e) {}
  });
  document.querySelectorAll(".cp-console-body:not([data-cp-menu-done])").forEach(function (b) {
    b.setAttribute("data-cp-menu-done", "1");
  });
}

document.addEventListener("cp:reskin", function () {
  try {
    wrapSearchBox();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin wrapSearchBox", e);
  }
  try {
    wrapResultsBox();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin wrapResultsBox", e);
  }
  try {
    moveButtonBar();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin moveButtonBar", e);
  }
  try {
    wrapResultsScroll();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin wrapResultsScroll", e);
  }
  try {
    trimEditColumn();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin trimEditColumn", e);
  }
  try {
    makeRowsClickable();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin makeRowsClickable", e);
  }
  try {
    wirePaginationIcons();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin wirePaginationIcons", e);
  }
  try {
    formatPageIndicator();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin formatPageIndicator", e);
  }
  try {
    wireSortIcons();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin wireSortIcons", e);
  }
  try {
    enhanceSelects();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin enhanceSelects", e);
  }
  try {
    wrapMenuCards();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin wrapMenuCards", e);
  }
  try {
    tagMenuColumns();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin tagMenuColumns", e);
  }
  try {
    tagSidebarIcons();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin tagSidebarIcons", e);
  }
  try {
    staggerCards();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin staggerCards", e);
  }
  try {
    suppressEmptyResults();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin suppressEmptyResults", e);
  }
  try {
    revealResultsBox();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin revealResultsBox", e);
  }
  try {
    restyleAlerts();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin restyleAlerts", e);
  }
});

/*
 * Make the whole .cp-menu-card clickable by forwarding clicks to its
 * inner a.navMenuItem link.  Uses capture-phase event delegation on
 * document so it's naturally idempotent (one binding for all cards).
 *
 * Double-fire guard: if the click originated on the link itself, let
 * the native click proceed normally without re-triggering.
 * Help-mode guard: when body.cp-help-active is set, don't forward
 * (help tooltips take precedence).
 */
(function wireCardClicks() {
  try {
    if (document.documentElement.dataset.cpCardClicks) return;
    document.documentElement.dataset.cpCardClicks = "1";

    document.addEventListener(
      "click",
      function (e) {
        var card = e.target.closest(".cp-menu-card");
        if (!card) return;

        /* Help mode — don't navigate */
        if (document.body.classList.contains("cp-help-active")) return;

        /* Click was directly on the link inside the card — let it handle */
        if (e.target.closest("a.navMenuItem")) return;

        var link = card.querySelector("a.navMenuItem");
        if (link) {
          e.preventDefault();
          link.click();
        }
      },
      true
    );
  } catch (e) {
    console.warn("[CommPilot Skin] wireCardClicks:", e);
  }
})();

/*
 * Move Help / Home / Logout links from the header into a footer row
 * at the bottom of the sidebar panel.  Each link is MOVED (not cloned)
 * so its original id, inline event listeners, and click handlers survive.
 */
function moveHeaderLinks() {
  try {
    if (document.querySelector(".cp-sidebar-footer")) return;

    const sidebar = document.querySelector('td.headandfoot[width="18%"]');
    if (!sidebar) return;

    const headerLinks = Array.from(
      document.querySelectorAll("a.headerLink")
    );

    const linkMap = {};
    headerLinks.forEach((link) => {
      const text = link.textContent.trim();
      if (text === "Help") linkMap.help = link;
      else if (text === "Home") linkMap.home = link;
      else if (text.toLowerCase().includes("logout")) linkMap.logout = link;
    });

    if (!linkMap.help && !linkMap.home && !linkMap.logout) return;

    const footer = document.createElement("div");
    footer.className = "cp-sidebar-footer";

    const entries = [
      { key: "help", label: "Help" },
      { key: "home", label: "Home" },
      { key: "logout", label: "Log out" },
    ];

    entries.forEach(({ key, label }) => {
      const link = linkMap[key];
      if (!link) return;
      link.classList.add("cp-footer-btn");
      link.dataset.cpIcon = key;
      link.textContent = "";
      link.title = label;
      link.setAttribute("aria-label", label);
      footer.appendChild(link);
    });

    if (footer.children.length > 0) {
      sidebar.appendChild(footer);
    }
  } catch (e) {
    console.warn("[CommPilot Skin] moveHeaderLinks:", e);
  }
}

/*
 * Forward the Home footer button's click to the header "Reseller" link.
 *
 * The Home link's original handler calls redirectPost('', {}) which posts
 * to an empty URL and triggers a logout error.  The Reseller link
 * (a.headerAuthLevelLink, text "Reseller") has the correct handler:
 * redirectPost('/commpilot/Common/folder_contents.jsp', { menuId: '8' }).
 *
 * Because redirectPost lives in the page's main world (not the content
 * script's isolated world), we cannot call it directly.  Instead we
 * suppress Home's broken handler via capture-phase stopPropagation and
 * programmatically .click() the Reseller link, which invokes the site's
 * own correct handler in its proper context.
 *
 * Only the Home click is intercepted — Help toggle and Logout are untouched.
 */
function cpWireHomeButton() {
  try {
    var homeBtn = document.querySelector('.cp-footer-btn[data-cp-icon="home"]');
    if (!homeBtn) return;
    if (homeBtn.dataset.cpHomeWired) return;
    homeBtn.dataset.cpHomeWired = "1";

    var resellerLink = document.querySelector('a.headerAuthLevelLink');

    if (!resellerLink) return;

    /* Verify the Reseller link text is "Reseller" */
    if (resellerLink.textContent.trim() !== "Reseller") return;

    homeBtn.addEventListener(
      "click",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        resellerLink.click();
      },
      true
    );
  } catch (e) {
    console.warn("[CommPilot Skin] wireHomeButton:", e);
  }
}

/*
 * Logout confirmation — Option A (centered modal).
 *
 * The footer "Log out" button is the legacy header logout <a> (moved into
 * the footer by moveHeaderLinks); its native handler signs the user out the
 * instant it's clicked. We intercept that click in the CAPTURE phase (the
 * same proven pattern as cpWireHomeButton) to suppress the immediate logout
 * and show a styled confirmation modal instead. On confirm we set a one-shot
 * bypass flag and re-dispatch the click so the legacy handler runs and does
 * the real logout; Cancel / backdrop / Esc just dismiss.
 */
/* Inner markup for the "Signing out…" splash — a spinning lavender ring with
   the same log-out icon as the confirmation dialog at its centre, plus a
   caption. Shared shape: cpShowLogoutModal morphs the dialog into this on
   confirm, and cloak.js paints the identical splash on the following documents
   (gated on the cp-signing-out flag) so the wait reads as one continuous
   branded screen until the login card renders. KEEP IN SYNC with cloak.js. */
function cpSignOutSplashHTML() {
  return '' +
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
    '</div>';
}

function cpShowLogoutModal(onConfirm) {
  try {
    if (document.querySelector(".cp-logout-overlay")) return;
    var prevFocus = document.activeElement;

    var overlay = document.createElement("div");
    overlay.className = "cp-logout-overlay";

    var modal = document.createElement("div");
    modal.className = "cp-logout-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "cp-logout-title");
    modal.innerHTML =
      '<div class="cp-logout-badge" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>' +
        '</svg>' +
      '</div>' +
      '<p class="cp-logout-title" id="cp-logout-title">Log out?</p>' +
      '<p class="cp-logout-sub">You’ll be signed out and returned to the CommPilot sign-in screen.</p>' +
      '<div class="cp-logout-btns">' +
        '<button type="button" class="cp-logout-btn cp-logout-cancel">Cancel</button>' +
        '<button type="button" class="cp-logout-btn cp-logout-confirm">Log out</button>' +
      '</div>';

    /* Personalise with the signed-in name when available (topbar mirror or
       the legacy welcome cell). Set via textContent so page text can't inject. */
    var name = "";
    var welcome = document.querySelector(".cp-welcome") || document.querySelector(".headerBarWelcome");
    if (welcome) name = (welcome.textContent || "").replace(/welcome/i, "").replace(/[!,]/g, "").trim();
    if (name) {
      var who = document.createElement("p");
      who.className = "cp-logout-who";
      who.textContent = "Signed in as " + name;
      modal.insertBefore(who, modal.querySelector(".cp-logout-btns"));
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      try {
        var a = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease" });
        a.onfinish = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      } catch (e) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

    modal.querySelector(".cp-logout-cancel").addEventListener("click", close);
    modal.querySelector(".cp-logout-confirm").addEventListener("click", function () {
      // Don't dismiss — MORPH this card in place into the "Signing out…" spinner,
      // so the loading status lives in the SAME popup as the confirmation (the dim
      // backdrop + the console behind it stay). The morph is a real scale/fade +
      // box-height transition (not an instant swap), so the two states ease into
      // each other. The background sign-out (pjax cpSignOutFetch) runs during it,
      // holds ~1.4s, then the page goes to login.
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      modal.setAttribute("aria-busy", "true");
      // Backdrop stays the dim translucent (CSS default) through the "Signing out…"
      // hold, so the console shows DIMMED behind the card (the popup-over-dimmed-
      // console look). The flash fix is NOT here: the base console is hidden only at
      // the very end, just before the navigation (pjax cpSignOutFetch.go), because
      // the flash is a document-swap TEARDOWN artifact, not the hold.
      var h1 = modal.offsetHeight;          // confirm-state height
      modal.style.overflow = "hidden";
      try { onConfirm(); } catch (e) {}     // start the sign-out now (runs under the morph)

      var swap = function () {
        modal.style.opacity = "0";          // hide while we swap content + remeasure
        modal.innerHTML = cpSignOutSplashHTML();
        modal.style.display = "flex";
        modal.style.flexDirection = "column";
        modal.style.justifyContent = "center";
        var h2 = modal.offsetHeight;        // spinner-state natural height
        modal.style.height = h1 + "px";
        var SPRING = "cubic-bezier(0.34,1.3,0.64,1)";
        if (modal.animate) {
          try {
            var hA = modal.animate([{ height: h1 + "px" }, { height: h2 + "px" }], { duration: 320, easing: SPRING });
            hA.onfinish = function () { modal.style.height = "auto"; modal.style.overflow = ""; };
          } catch (e) { modal.style.height = "auto"; modal.style.overflow = ""; }
          try {
            var inA = modal.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "scale(1)" }], { duration: 300, easing: SPRING });
            inA.onfinish = function () { modal.style.opacity = ""; };
          } catch (e) { modal.style.opacity = ""; }
        } else { modal.style.opacity = ""; modal.style.height = "auto"; modal.style.overflow = ""; }
      };

      if (modal.animate) {
        var outA = modal.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.92)" }], { duration: 150, easing: "ease-in" });
        outA.onfinish = swap;
      } else { swap(); }
    });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    /* Entrance animation — WAAPI, consistent with the project's motion. */
    try {
      overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease" });
      modal.animate(
        [{ opacity: 0, transform: "scale(0.96) translateY(6px)" }, { opacity: 1, transform: "none" }],
        { duration: 200, easing: "cubic-bezier(0.34,1.4,0.64,1)" }
      );
    } catch (e) {}

    var confirmBtn = modal.querySelector(".cp-logout-confirm");
    if (confirmBtn) { try { confirmBtn.focus(); } catch (e) {} }
  } catch (e) {
    console.warn("[CommPilot Skin] logoutModal:", e);
  }
}

/*
 * Intercept the footer Log out button → show cpShowLogoutModal first.
 * Mirrors cpWireHomeButton: capture-phase suppression of the legacy click.
 * The one-shot btn._cpLogoutGo flag lets the confirmed re-click fall through
 * to the legacy handler. Wired alongside cpWireHomeButton in cpSkinDomPass;
 * the footer persists across pjax swaps (it's a sibling of leftNavForm), so
 * the binding survives — the dataset guard prevents a double-bind.
 */
function cpWireLogoutButton() {
  try {
    var btn = document.querySelector('.cp-footer-btn[data-cp-icon="logout"]');
    if (!btn) return;
    if (btn.dataset.cpLogoutWired) return;
    btn.dataset.cpLogoutWired = "1";
    btn.addEventListener(
      "click",
      function (e) {
        if (btn._cpLogoutGo) { btn._cpLogoutGo = false; return; } // confirmed → let the native logout run
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cpShowLogoutModal(function () {
          try { sessionStorage.setItem("cp-signing-out", String(Date.now())); } catch (e) {} // → spinner splash on the next docs
          btn._cpLogoutGo = true;
          btn.click();
        });
      },
      true
    );
  } catch (e) {
    console.warn("[CommPilot Skin] wireLogoutButton:", e);
  }
}

/*
 * Append a sort-direction icon to the active column header.
 *
 * The sorted column is identified by the presence of a legacy arrow gif
 * (uparrow.gif = ascending, downarrow.gif = descending) inside an
 * a.listSortHeader element.  We append a span with the cp-sort-asc or
 * cp-sort-desc class; the background-image is injected by injectAssetCss
 * via chrome.runtime.getURL.  The legacy gif is hidden by CSS.
 *
 * The anchor node is preserved (including its toggleSort handler), and
 * the icon span is a child so sorting still works.
 */
function wireSortIcons() {
  try {
    var sortLinks = document.querySelectorAll("a.listSortHeader");
    sortLinks.forEach(function (link) {
      try {
        if (link.querySelector(".cp-sort-ico")) return; // already wired
        var arrow = link.querySelector('img[src*="uparrow.gif"]');
        if (arrow) {
          var span = document.createElement("span");
          span.className = "cp-sort-ico cp-sort-asc";
          link.appendChild(span);
          return;
        }
        arrow = link.querySelector('img[src*="downarrow.gif"]');
        if (arrow) {
          var span = document.createElement("span");
          span.className = "cp-sort-ico cp-sort-desc";
          link.appendChild(span);
          return;
        }
      } catch (e) {
        console.warn("[CommPilot Skin] wireSortIcons item:", e);
      }
    });
  } catch (e) {
    console.warn("[CommPilot Skin] wireSortIcons:", e);
  }
}

/*
 * Wire the "+" add-row buttons.  Styling is handled by CSS attribute
 * selectors (input.bwbutton[value="+"]) that auto-apply to dynamically-
 * created buttons, so this IIFE only sets a global idempotency flag.
 */
(function wirePlusButton() {
  try {
    if (document.documentElement.dataset.cpPlusWired) return;
    document.documentElement.dataset.cpPlusWired = "1";
  } catch (e) {
    console.warn("[CommPilot Skin] wirePlusButton:", e);
  }
})();

/*
 * Replace pagination text links (First / Previous / Next / Last) with
 * icon buttons.
 *
 * These are a.headerLink elements inside table.enduserbody:not(#searchTable).
 * We preserve the <a> node (including its doPage click handler), set its
 * text invisible, add a marker class + data-cp-page attribute, and set
 * title/aria-label for accessibility.  The icon background-image is
 * injected by injectAssetCss via chrome.runtime.getURL.
 *
 * Scoping to table.enduserbody:not(#searchTable) ensures sidebar footer
 * headerLinks are not affected.
 */
function wirePaginationIcons() {
  try {
    var pageTables = document.querySelectorAll("table.enduserbody:not(#searchTable)");
    pageTables.forEach(function (tbl) {
      try {
        var links = tbl.querySelectorAll("a.headerLink");
        links.forEach(function (link) {
          if (link.classList.contains("cp-page-btn")) return;
          var text = link.textContent.trim();
          var dir = null;
          if (text === "First") dir = "first";
          else if (text === "Previous") dir = "prev";
          else if (text === "Next") dir = "next";
          else if (text === "Last") dir = "last";
          if (!dir) return;
          link.classList.add("cp-page-btn");
          link.dataset.cpPage = dir;
          link.textContent = "";
          link.title = text;
          link.setAttribute("aria-label", text);
        });
      } catch (e) {
        console.warn("[CommPilot Skin] wirePaginationIcons table:", e);
      }
    });
  } catch (e) {
    console.warn("[CommPilot Skin] wirePaginationIcons:", e);
  }
}

/*
 * Reformat the legacy "[ Page N of M ]" pagination text into a compact
 * "N / M" pill.  Idempotent (skips already-wrapped cells) and safe to
 * re-run after pjax page changes.
 */
function formatPageIndicator() {
  try {
    var tables = document.querySelectorAll("table.enduserbody:not(#searchTable)");
    tables.forEach(function (tbl) {
      tbl.querySelectorAll("td").forEach(function (td) {
        if (td.querySelector("td, a, .cp-page-indicator")) return; // leaf cell, no links, not already done
        var m = td.textContent.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        if (!m) return;
        td.textContent = "";
        var wrap = document.createElement("span");
        wrap.className = "cp-page-indicator";
        var cur = document.createElement("span"); cur.className = "cp-page-cur"; cur.textContent = m[1];
        var sep = document.createElement("span"); sep.className = "cp-page-sep"; sep.textContent = "/";
        var tot = document.createElement("span"); tot.className = "cp-page-tot"; tot.textContent = m[2];
        wrap.appendChild(cur); wrap.appendChild(sep); wrap.appendChild(tot);
        td.appendChild(wrap);
      });
    });
  } catch (e) { console.warn("[CommPilot Skin] formatPageIndicator:", e); }
}

/*
 * Replace the native <select> popups in the search criteria with a branded,
 * animated custom dropdown.  The native <select> is kept in the form (hidden
 * via inline display:none) and synced on every choice (value set + change
 * dispatched) so the site's getChoice handler and the search submit still
 * work.  Idempotent (per-select flag); re-runs on reskin and on "+" rows.
 */
function enhanceSelects() {
  try {
    function processSelect(sel) {
      if (sel.dataset.cpDd) return;
      sel.dataset.cpDd = "1";
      var dd = document.createElement("div"); dd.className = "cp-dd";
      var trg = document.createElement("button"); trg.type = "button"; trg.className = "cp-dd-trigger";
      trg.setAttribute("aria-haspopup", "listbox"); trg.setAttribute("aria-expanded", "false");
      var lbl = document.createElement("span"); lbl.className = "cp-dd-label";
      var chev = document.createElement("span"); chev.className = "cp-dd-chevron";
      trg.appendChild(lbl); trg.appendChild(chev);
      var list = document.createElement("ul"); list.className = "cp-dd-list"; list.setAttribute("role", "listbox");
      function close() { dd.classList.remove("open"); trg.setAttribute("aria-expanded", "false"); }
      function open() {
        document.querySelectorAll(".cp-dd.open").forEach(function (x) {
          if (x !== dd) { x.classList.remove("open"); var t = x.querySelector(".cp-dd-trigger"); if (t) t.setAttribute("aria-expanded", "false"); }
        });
        dd.classList.add("open"); trg.setAttribute("aria-expanded", "true");
        var r = trg.getBoundingClientRect();
        list.style.top = (r.bottom + 4) + "px";
        list.style.left = r.left + "px";
        list.style.minWidth = r.width + "px";
        var drift = list.getBoundingClientRect().left - r.left;
        if (Math.abs(drift) > 0.5) list.style.left = (r.left - drift) + "px";
      }
      function sync() {
        list.innerHTML = "";
        Array.prototype.forEach.call(sel.options, function (opt) {
          var li = document.createElement("li"); li.className = "cp-dd-opt"; li.setAttribute("role", "option");
          li.textContent = opt.text.trim(); li.dataset.value = opt.value;
          if (opt.selected) li.setAttribute("aria-selected", "true");
          li.addEventListener("click", function (e) {
            e.stopPropagation();
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            close();
          });
          list.appendChild(li);
        });
        var o = sel.options[sel.selectedIndex];
        lbl.textContent = o ? o.text.trim() : "";
      }
      trg.addEventListener("click", function (e) { e.stopPropagation(); dd.classList.contains("open") ? close() : open(); });
      sel.addEventListener("change", function () { sync(); });
      dd.appendChild(trg); dd.appendChild(list);
      sel.parentNode.insertBefore(dd, sel.nextSibling);
      sel.style.setProperty("display", "none", "important");
      sync();
    }
    document.querySelectorAll("#searchTable select").forEach(processSelect);
    document.querySelectorAll(".cp-console-body select").forEach(processSelect);
  } catch (e) { console.warn("[CommPilot Skin] enhanceSelects:", e); }
}
(function cpDropdownGlobalInit() {
  try {
    if (document.documentElement.dataset.cpDdInit) return;
    document.documentElement.dataset.cpDdInit = "1";
    document.addEventListener("click", function () {
      document.querySelectorAll(".cp-dd.open").forEach(function (dd) {
        dd.classList.remove("open");
        var t = dd.querySelector(".cp-dd-trigger"); if (t) t.setAttribute("aria-expanded", "false");
      });
    });
    /* Smooth add/remove of search-criteria rows. Capture phase runs BEFORE
       the page's legacy addRow/delRow click handler (attached directly to
       the button), so we snapshot the search box height + row positions;
       the bubble-phase document listener runs AFTER it in the SAME event
       dispatch, so we re-enhance selects, measure, and start every
       animation synchronously — no task boundary means the browser never
       paints the raw intermediate state (un-enhanced selects shifting
       columns / new row visible before its fade begins). */
    var cpSearchSnap = null;
    function isAddDelBtn(t) {
      return t && t.matches && t.matches('input.bwbutton[value="+"], input.bwbutton[value="-"]');
    }
    document.addEventListener("click", function (e) {
      if (!isAddDelBtn(e.target)) return;
      var box = e.target.closest(".cp-search-box");
      if (!box) return;
      var rows = [];
      box.querySelectorAll("tr").forEach(function (tr) {
        rows.push({ tr: tr, top: tr.getBoundingClientRect().top });
      });
      var btns = {};
      box.querySelectorAll('input.bwbutton').forEach(function (b) {
        if (b.value === "+" || b.value === "Search") (btns[b.value] = btns[b.value] || []).push(b.getBoundingClientRect());
      });
      cpSearchSnap = { box: box, h: box.getBoundingClientRect().height, rows: rows, btns: btns };
    }, true);
    document.addEventListener("click", function (e) {
      if (!isAddDelBtn(e.target)) return;
      enhanceSelects();
      var snap = cpSearchSnap;
      cpSearchSnap = null;
      if (!snap) return;
      try {
        var box = snap.box;
        var ease = "cubic-bezier(0,0,0.2,1)";
        var newH = box.getBoundingClientRect().height;
        if (Math.abs(newH - snap.h) > 1) {
          box.animate(
            [{ height: snap.h + "px" }, { height: newH + "px" }],
            { duration: 240, easing: ease }
          );
        }
        var oldTops = new Map();
        snap.rows.forEach(function (r) { oldTops.set(r.tr, r.top); });
        box.querySelectorAll("tr").forEach(function (tr) {
          if (!oldTops.has(tr)) {
            tr.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              { duration: 200, delay: 80, easing: ease, fill: "backwards" }
            );
          } else {
            var dy = oldTops.get(tr) - tr.getBoundingClientRect().top;
            if (Math.abs(dy) > 1) {
              tr.animate(
                [{ transform: "translateY(" + dy + "px)" }, { transform: "none" }],
                { duration: 240, easing: ease }
              );
            }
          }
        });
        /* The legacy code recreates + and Search on whichever row is
           last — glide them from their old spot to the new one instead
           of teleporting. Singleton match by value; skip if counts
           differ (unexpected layout). */
        ["+", "Search"].forEach(function (v) {
          var olds = (snap.btns && snap.btns[v]) || [];
          var news = box.querySelectorAll('input.bwbutton[value="' + v + '"]');
          if (olds.length === 1 && news.length === 1) {
            var r = news[0].getBoundingClientRect();
            var dx = olds[0].left - r.left;
            var dy = olds[0].top - r.top;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
              news[0].animate(
                [{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }],
                { duration: 240, easing: ease }
              );
            }
          }
        });
      } catch (err) {}
    });
    window.addEventListener("scroll", function () {
      document.querySelectorAll(".cp-dd.open").forEach(function (dd) {
        dd.classList.remove("open");
        var t = dd.querySelector(".cp-dd-trigger"); if (t) t.setAttribute("aria-expanded", "false");
      });
    }, true);
  } catch (e) { console.warn("[CommPilot Skin] cpDropdownGlobalInit:", e); }
})();

function staggerCards() {
  try {
    /* Menu cards (BASIC/ADVANCED columns) — tune independently of rows */
    var CARD_STEP = 65, CARD_DUR = 250;
    /* Result rows (Groups & other list pages) — smaller step so a full
       page of rows finishes quickly with NO cap (a cap makes every row
       past it share one delay and pop in simultaneously) */
    var ROW_STEP = 40, ROW_DUR = 220;
    function run(el, delay, dur) {
      try {
        el.animate(
          [
            { opacity: 0, transform: "scale(0.97)" },
            { opacity: 1, transform: "scale(1)" }
          ],
          { duration: dur, delay: delay, easing: "cubic-bezier(0,0,0.2,1)", fill: "backwards" }
        );
      } catch (e) {}
    }
    // Menu cards: stagger within each column so both columns fill top-down. SKIP console
    // sections here — cp:reskin fires on every section lazy-load, so this global pass would
    // re-animate all already-shown console cards each time. Console sections are handled below,
    // gated per-body so each section waterfalls exactly ONCE (the reskin where its cards land).
    document.querySelectorAll("td.cp-menu-col").forEach(function (col) {
      if (col.closest(".cp-console")) return;
      col.querySelectorAll(".cp-menu-card").forEach(function (card, i) { run(card, i * CARD_STEP, CARD_DUR); });
    });
    // Console sections: waterfall each section's cards the first time it has them (i.e. right
    // as it lazy-loads), masking the section load. Per-column so both BASIC/ADVANCED columns
    // fill top-down in parallel, matching the list/menu look. data-cp-staggered gates it to once.
    document.querySelectorAll(".cp-console-body:not([data-cp-staggered])").forEach(function (body) {
      if (!body.querySelector(".cp-menu-card")) return;   // not loaded yet — let a later reskin catch it
      body.setAttribute("data-cp-staggered", "1");
      body.querySelectorAll("td.cp-menu-col").forEach(function (col) {
        col.querySelectorAll(".cp-menu-card").forEach(function (card, i) { run(card, i * CARD_STEP, CARD_DUR); });
      });
    });
    // Result rows: stagger down the whole list at the row cadence
    document.querySelectorAll(".cp-results-box tr.unselected").forEach(function (row, i) {
      run(row, i * ROW_STEP, ROW_DUR);
    });
  } catch (e) { console.warn("[CommPilot Skin] staggerCards:", e); }
}

/*
 * Grow-in entrance for the results box. Animates height 0 -> measured
 * height with a fade, but only when the box NEWLY appears (search on an
 * empty list) — cpResultsWasVisible tracks whether the previous content
 * already had a results box, so pagination/sort swaps don't re-grow it.
 * Runs after layout (wrapResultsBox + wrapResultsScroll) so the measured
 * height is final.
 */
var cpResultsWasVisible = false;
function revealResultsBox() {
  try {
    var box = document.querySelector(".cp-results-box");
    var wasVisible = cpResultsWasVisible;
    cpResultsWasVisible = !!box;
    if (!box || wasVisible) return;
    var h = box.getBoundingClientRect().height;
    if (!h) return;
    var prevOverflow = box.style.overflow;
    box.style.overflow = "hidden";
    var anim = box.animate(
      [
        { height: "0px", opacity: 0 },
        { height: h + "px", opacity: 1 }
      ],
      { duration: 360, easing: "cubic-bezier(0,0,0.2,1)" }
    );
    anim.onfinish = function () { box.style.overflow = prevOverflow; };
  } catch (e) { console.warn("[CommPilot Skin] revealResultsBox:", e); }
}

/*
 * Wrap the results table, spacer, and pagination table into a single
 * canonical box (.cp-results-box).
 *
 * On list pages, td.enduserbody contains (in order):
 *   1. searchTable (optional, already its own canonical box)
 *   2. results table (<table> with a.listSortHeader children)
 *   3. spacer table (<table> with onepx.gif)
 *   4. pagination table (<table class="enduserbody"> without id)
 *
 * This function finds the results table, creates a <div class="cp-results-box">
 * as a wrapper, and moves the results table, spacer, and pagination table
 * into it.  The wrapper replaces the results table in the DOM flow.
 *
 * Skipped silently on menu pages (no results table).
 * Idempotent — safe to call multiple times.
 */
function wrapResultsBox() {
  try {
    var bodyTd = document.querySelector("td.enduserbody");
    if (!bodyTd) return;

    /* Find the results table */
    var resultsTable = bodyTd.querySelector(
      'table:has(> tbody > tr > td.listHeader > a.listSortHeader)'
    );
    if (!resultsTable) return; /* not a list page — skip */
    if (resultsTable.closest(".cp-results-box")) return; /* already wrapped */

    /* Find the pagination table */
    var paginationTable = bodyTd.querySelector(
      'table.enduserbody:not(#searchTable)'
    );
    if (!paginationTable) return;

    /* Find the spacer between results and pagination (onepx.gif table) */
    var spacerTable = null;
    var nextEl = resultsTable.nextElementSibling;
    if (
      nextEl &&
      nextEl.tagName === "TABLE" &&
      nextEl.querySelector('img[src*="onepx.gif"]')
    ) {
      spacerTable = nextEl;
    }

    /* Create wrapper div */
    var wrapper = document.createElement("div");
    wrapper.className = "cp-results-box";

    /* Insert wrapper before the results table */
    bodyTd.insertBefore(wrapper, resultsTable);

    /* Move children into wrapper */
    wrapper.appendChild(resultsTable);
    if (spacerTable) wrapper.appendChild(spacerTable);
    wrapper.appendChild(paginationTable);
  } catch (e) {
    console.warn("[CommPilot Skin] wrapResultsBox:", e);
  }
}

/*
 * Wrap the search panel table in a rounded glass container div,
 * matching the treatment wrapResultsBox gives the results table.
 * Idempotent — safe to call multiple times.
 */
function wrapSearchBox() {
  try {
    var searchTable = document.getElementById("searchTable");
    if (!searchTable) return;
    if (searchTable.closest(".cp-search-box")) return; /* already wrapped */

    var wrapper = document.createElement("div");
    wrapper.className = "cp-box cp-search-box";

    searchTable.parentNode.insertBefore(wrapper, searchTable);
    wrapper.appendChild(searchTable);
  } catch (e) {
    console.warn("[CommPilot Skin] wrapSearchBox:", e);
  }
}

/*
 * Login page — build a centered glass card from the legacy form fields.
 * Idempotent: checks for .cp-login-card before rebuilding.
 */
var cpLoginExitAnim = null;
var cpLoginEntranceDone = false;
var cpLoginMorphPending = false;
var cpSplashShownAt = 0;
var cpSplashPulseAnim = null;
var cpLoginBtnOrigText = "";
function cpResetLoginButton() {
  var b = document.querySelector(".cp-login-btn");
  if (!b) return;
  b.classList.remove("cp-login-btn-loading");
  b.style.removeProperty("pointer-events");
  var sp = b.querySelector(".cp-login-spinner"); if (sp) sp.remove();
  if (cpLoginBtnOrigText) b.textContent = cpLoginBtnOrigText;
}
var cpWireHelpBodyFn = null;
function buildLoginCard() {
  try {
    var form = document.querySelector('form[name="loginForm"]');
    if (!form || !form.querySelector('input[name="Password"]')) return; // not login page
    try { sessionStorage.removeItem("cp-signing-out"); } catch (e) {} // reached login → end the sign-out splash
    if (form.querySelector(".cp-login-card")) return; // idempotent

    document.body.classList.add("cp-login-page");

    var card = document.createElement("div");
    card.className = "cp-login-card";

    // LEFT — brand panel (purple gradient): mark + "CommPilot" wordmark + tagline.
    var brandPanel = document.createElement("div");
    brandPanel.className = "cp-login-brand-panel";
    var logo = document.createElement("img");
    logo.className = "cp-login-logo";
    logo.src = chrome.runtime.getURL("assets/icons/trifecta-mark.svg");
    logo.alt = "";
    logo.style.opacity = "0";
    var _revealLogo = function () { try { logo.style.opacity = "1"; } catch (e) {} };
    if (logo.complete && logo.naturalWidth > 0) { _revealLogo(); }
    else {
      logo.addEventListener("load", _revealLogo, { once: true });
      logo.addEventListener("error", _revealLogo, { once: true });
    }
    var brand = document.createElement("div");
    brand.className = "cp-login-brand";
    brand.appendChild(document.createTextNode("Comm"));
    var brandAccent = document.createElement("span");
    brandAccent.className = "cp-login-brand-accent";
    brandAccent.textContent = "Pilot";
    brand.appendChild(brandAccent);
    var tagline = document.createElement("div");
    tagline.className = "cp-login-tagline";
    tagline.textContent = "Communications portal";
    brandPanel.appendChild(logo);
    brandPanel.appendChild(brand);
    brandPanel.appendChild(tagline);

    // RIGHT — form panel: optional alert + fields + remember + Sign In.
    var formPanel = document.createElement("div");
    formPanel.className = "cp-login-form-panel";

    // Session/auth notice -> styled alert (only when present)
    var notice = document.querySelector(".loginerror");
    if (!notice || !notice.textContent.trim()) {
      notice = Array.prototype.slice.call(document.querySelectorAll("td,span,div,p,b,font")).find(function (e) {
        return e.childElementCount === 0 && /not authorized|login again|session timeout|disabled|locked/i.test(e.textContent || "");
      });
    }
    if (notice && notice.textContent.trim()) {
      var al = document.createElement("div");
      al.className = "cp-login-alert";
      al.innerHTML = '<svg class="cp-login-alert-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span class="cp-login-alert-msg"></span>';
      al.querySelector(".cp-login-alert-msg").textContent = notice.textContent.trim();
      formPanel.appendChild(al);
    }

    // Field groups — MOVE the real inputs so names + handlers survive
    [{ name: "EnteredUserID", label: "User ID" },
     { name: "Password", label: "Password" }].forEach(function (f) {
      var input = form.querySelector('input[name="' + f.name + '"]');
      if (!input) return;
      var field = document.createElement("div");
      field.className = "cp-login-field";
      var lbl = document.createElement("label");
      lbl.className = "cp-login-label";
      lbl.textContent = f.label;
      input.classList.add("cp-login-input");
      field.appendChild(lbl);
      field.appendChild(input);
      formPanel.appendChild(field);
    });

    // Remember password row
    var cb = form.querySelector('input[name="rememberPass"]');
    if (cb) {
      var row = document.createElement("label");
      row.className = "cp-login-remember";
      cb.classList.add("cp-login-check");
      var sp = document.createElement("span");
      sp.textContent = "Remember password";
      row.appendChild(cb);
      row.appendChild(sp);
      formPanel.appendChild(row);
    }

    // Login button — reuse the existing <a> (preserves its submit handler)
    var btn = Array.prototype.slice.call(form.querySelectorAll("a"))
      .find(function (a) { var t = a.textContent.trim(); return t === "Login" || t === "Sign In"; });
    if (btn) {
      btn.classList.add("cp-login-btn");
      btn.textContent = "Sign In";
      formPanel.appendChild(btn);
    }

    card.appendChild(brandPanel);
    card.appendChild(formPanel);

    // Hide legacy presentation inside the form (keep our card + hidden inputs)
    Array.prototype.slice.call(form.children).forEach(function (child) {
      if (child === card) return;
      if (child.tagName === "INPUT" && child.type === "hidden") return;
      child.style.display = "none";
    });

    form.appendChild(card);

    // Splash (cloak.js) still covering — whether this is a normal login load or a
    // sign-out arrival (cloak.js paints the "Signing out…" spinner). Either way,
    // keep the card hidden and let cpRevealCloak fade the cloak out / card in.
    // (The sign-out → login morph was removed; the spinner cross-fades to the card.)
    var cloakEl = document.getElementById("cp-cloak");
    if (cloakEl) {
      card.style.opacity = "0";
    } else {
      cpLoginEntrance();
    }
  } catch (e) {
    console.warn("[CommPilot Skin] buildLoginCard:", e);
  }
}

/* Stagger the login card + children in. Runs once; callable from build
   (no splash), the reveal block (splash fading), or the cloak observer. */
function cpLoginEntrance() {
  if (cpLoginEntranceDone) return;
  var card = document.querySelector(".cp-login-card");
  if (!card) return;
  cpLoginEntranceDone = true;
  card.style.removeProperty("opacity");
  card.animate(
    [{ opacity: 0, transform: "translateY(12px) scale(0.99)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
    { duration: 300, easing: "cubic-bezier(0,0,0.2,1)" }
  );
}

/*
 * Post-logout handling — go STRAIGHT to the styled login. The raw BroadSoft
 * /Logout/ landing (a "Logout" heading + two links that both just return to
 * /Login/) is never shown; we replace it with /Login/, so the experience is
 * confirm → "Signing out…" splash → login card. The splash (cloak.js, gated on
 * the cp-signing-out flag) covers this hop, so there's no flash. location.replace
 * keeps /Logout/ out of history (Back won't return to the dead page). Returns
 * true when it redirected so cpSkinDomPass can stop the rest of the pass.
 */
function cpLogoutToLogin() {
  try {
    if (location.pathname.indexOf("/Logout/") === -1) return false;
    location.replace("/commpilot/Login/");
    return true;
  } catch (e) {
    console.warn("[CommPilot Skin] logoutToLogin:", e);
    return false;
  }
}

/*
 * Login transition — when a login actually submits, dissolve the card into
 * the same dark "CommPilot" splash that cloak.js paints on every incoming
 * page. All login hops are same-origin POSTs, so paint holding carries the
 * identical splash through the round-trip and the home page fades in from
 * it — one continuous transition instead of a page-load pop.
 */
function cpLoginSplash() {
  if (document.getElementById("cp-cloak")) return;
  // Not during a sign-out: this fires on EVERY beforeunload (skin.js end), so the
  // logout navigation would otherwise spawn a competing #cp-cloak (z above the
  // logout overlay, fading in) at the exact document-swap moment — a flash source.
  // The logout flow has its own opaque cover; let it own the transition.
  try { var _so = parseInt(sessionStorage.getItem("cp-signing-out") || "0", 10); if (_so && (Date.now() - _so < 15000)) return; } catch (e) {}
  // Button feedback
  var btn = document.querySelector(".cp-login-btn");
  if (btn && !btn.classList.contains("cp-login-btn-loading")) {
    cpLoginBtnOrigText = btn.textContent;
    btn.textContent = "";
    var sp = document.createElement("span");
    sp.className = "cp-login-spinner";
    sp.style.cssText = "border:2px solid rgba(198,168,232,0.35);border-top-color:#C6A8E8;border-radius:50%;width:14px;height:14px;margin-right:8px;vertical-align:-2px;display:inline-block";
    btn.appendChild(sp);
    btn.appendChild(document.createTextNode("Signing in\u2026"));
    if (sp.animate) {
      sp.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 700, iterations: Infinity, easing: "linear" });
    }
    btn.classList.add("cp-login-btn-loading");
    btn.style.pointerEvents = "none";
  }
  // Card exit with delay so button state registers
  var exitCard = document.querySelector(".cp-login-card");
  if (exitCard) {
    cpLoginExitAnim = exitCard.animate(
      [{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(-6px) scale(0.985)" }],
      { duration: 180, easing: "ease-out", fill: "forwards", delay: 120 }
    );
  }
  cpLoginMorphPending = true;
  cpSplashShownAt = performance.now();
  document.documentElement.classList.add("cp-stub-hold");
  var o = document.createElement("div");
  o.id = "cp-cloak";
  o.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:2147483647;background:#1c1b19;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;"
  );
  var mark = document.createElement("img");
  mark.className = "cp-cloak-mark";
  mark.src = chrome.runtime.getURL("assets/icons/trifecta-mark.svg");
  mark.style.cssText = "width:72px;height:auto;opacity:0";
  o.appendChild(mark);
  var word = document.createElement("div");
  word.className = "cp-cloak-word";
  word.style.cssText = "font:600 14px/1.4 'Nunito','Segoe UI',system-ui,sans-serif;color:#a4a29c;margin-top:14px;opacity:0";
  word.textContent = "CommPilot";
  o.appendChild(word);
  document.documentElement.appendChild(o);
  if (o.animate) {
    o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }
  var _startMarkAnims = function () {
    if (mark.animate) {
      mark.animate([{ opacity: 0, transform: "scale(0.82)" }, { opacity: 1, transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(0,0,0.2,1)", fill: "forwards" });
      word.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out", delay: 100, fill: "forwards" });
      cpSplashPulseAnim = mark.animate([{ transform: "scale(1)" }, { transform: "scale(1.045)" }, { transform: "scale(1)" }], { duration: 1600, iterations: Infinity, easing: "ease-in-out" });
    }
  };
  if (mark.complete && mark.naturalWidth > 0) { _startMarkAnims(); }
  else {
    mark.addEventListener("load", _startMarkAnims, { once: true });
    setTimeout(_startMarkAnims, 250);
  }
  // Failsafe: if no navigation ever happens (legacy validation blocked the
  // submit), give the form back.
  setTimeout(function () {
    var still = document.getElementById("cp-cloak");
    if (!still) return;
    document.documentElement.classList.remove("cp-stub-hold");
    cpResetLoginButton();
    cpLoginMorphPending = false;
    if (cpSplashPulseAnim) { try { cpSplashPulseAnim.cancel(); } catch (e) {} cpSplashPulseAnim = null; }
    var drop = function () { try { still.remove(); } catch (e) {} };
    if (still.animate) {
      still.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out" }).onfinish = drop;
      setTimeout(drop, 400);
    } else {
      drop();
    }
  }, 8000);
}

function cpWireLoginBody() {
  var form = document.querySelector('form[name="loginForm"]');
  if (!form || form.dataset.cpLoginWired) return;
  form.dataset.cpLoginWired = "1";
  function fieldsFilled() {
    var u = form.querySelector('input[name="EnteredUserID"]');
    var p = form.querySelector('input[name="Password"]');
    return !!(u && p && u.value.trim() && p.value);
  }
  var btn = form.querySelector(".cp-login-btn");
  if (btn) {
    btn.addEventListener("click", function () { if (fieldsFilled()) cpLoginSplash(); }, true);
  }
  form.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && fieldsFilled()) cpLoginSplash();
  }, true);
}
window.addEventListener("beforeunload", function () { cpLoginSplash(); });

/* Watch for #cp-cloak removal to animate card back in on failed login. */
(function setupLoginReturnAnim() {
  if (!document.querySelector('form[name="loginForm"]')) return;
  var obs = new MutationObserver(function (mutations) {
    for (var mi = 0; mi < mutations.length; mi++) {
      var mut = mutations[mi];
      for (var ri = 0; ri < mut.removedNodes.length; ri++) {
        if (mut.removedNodes[ri].id === "cp-cloak") {
          /* First removal = the initial page reveal — that's the entrance,
             not a failed-login return. */
          if (!cpLoginEntranceDone) { cpLoginEntrance(); break; }
          if (cpLoginExitAnim) { cpLoginExitAnim.cancel(); cpLoginExitAnim = null; }
          cpResetLoginButton(); cpLoginMorphPending = false;
          if (cpSplashPulseAnim) { try { cpSplashPulseAnim.cancel(); } catch (e) {} cpSplashPulseAnim = null; }
          var card = document.querySelector(".cp-login-card");
          if (card) {
            card.style.opacity = "0";
            card.style.transform = "translateY(-6px) scale(0.985)";
            if (cpLoginExitAnim) { try { cpLoginExitAnim.cancel(); } catch (e) {} cpLoginExitAnim = null; }
            var _ret = card.animate(
              [{ opacity: 0, transform: "translateY(-6px) scale(0.985)" },
               { opacity: 1, transform: "translateY(0) scale(1)" }],
              { duration: 280, easing: "cubic-bezier(0,0,0.2,1)", fill: "both" }
            );
            _ret.onfinish = function () { try { card.style.opacity = ""; card.style.transform = ""; } catch (e) {} };
            var alertEl = card.querySelector(".cp-login-alert");
            if (alertEl) {
              var ah = alertEl.getBoundingClientRect().height;
              if (ah) {
                var prevOverflow = alertEl.style.overflow;
                alertEl.style.overflow = "hidden";
                /* height animation needs border-box or the padding stays
                   visible at height:0 (same fix as the .cp-alert grow-in) */
                alertEl.style.boxSizing = "border-box";
                alertEl.animate(
                  [{ height: "0px", opacity: 0 }, { height: ah + "px", opacity: 1 }],
                  { duration: 260, easing: "ease-out" }
                ).onfinish = function () { alertEl.style.overflow = prevOverflow; };
              }
            }
          }
          break;
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true });
})();

/* Inline Lucide SVGs for the pill breadcrumb (kept identical to pjax.js cpBuildConsole so the console
 * and the list/leaf pages render the same crumb). route = leading glyph; arrow = separator. */
var CP_BC_ROUTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>';
var CP_BC_ARROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

/*
 * Build the breadcrumb as the PILL TRAIL (Option B) on list/leaf pages — the same look as the console
 * (pjax cpBuildConsole). The real a.headerAuthLevelLink elements are MOVED into the bar so they keep
 * their native onclick (ancestors stay clickable for free); the current/last level is neutralised.
 * The `if (.cp-breadcrumb) return` guard means the console's own pill crumb wins on console pages.
 */
function cpMoveBreadcrumb() {
  try {
    if (document.querySelector(".cp-breadcrumb")) return;

    var src = document.querySelector("td.headerBar a.headerAuthLevelLink");
    if (!src) return;
    var cell = src.closest("td");
    if (!cell) return;

    var title = document.querySelector("td.screenName");
    if (!title) return;
    var titleTable = title.closest("table");
    if (!titleTable) return;

    /* The real trail links, in order, deduped against consecutive repeats (the auth links can repeat). */
    var links = Array.prototype.slice.call(cell.querySelectorAll("a.headerAuthLevelLink"));
    var segs = [];
    for (var i = 0; i < links.length; i++) {
      var t = (links[i].textContent || "").trim();
      if (t && (!segs.length || (segs[segs.length - 1].textContent || "").trim() !== t)) segs.push(links[i]);
    }
    if (!segs.length) return;

    var bar = document.createElement("div");
    bar.className = "cp-breadcrumb cp-bc-pill";
    var lead = document.createElement("span");
    lead.className = "cp-bc-lead";
    lead.setAttribute("aria-hidden", "true");
    lead.innerHTML = CP_BC_ROUTE_SVG;
    bar.appendChild(lead);

    /* Current ENTITY (e.g. a user id) lives in span.headerAuthLevel, separate from the level links.
       If present, every level link becomes a clickable ancestor and the entity is the current pill. */
    var curSpan = document.querySelector("span.headerAuthLevel");
    var curEnt = curSpan ? (curSpan.textContent || "").replace(/^\s*:\s*/, "").trim() : "";
    if (curEnt && (segs[segs.length - 1].textContent || "").trim() === curEnt) curEnt = "";   /* dedupe vs last level */
    /* At the user level any "Users" members-list link is redundant with the entity id ("… Group › Users ›
       id" → "… Group › id"); its position varies, so drop EVERY "Users" link (keep the other ancestors). */
    if (curEnt && segs.length > 1) segs = segs.filter(function (a) { return (a.textContent || "").trim() !== "Users"; });

    /* On a plain LIST/section page (no entity) name the page itself as the current pill, from the
       screenName (e.g. "Service Providers"), so the trail reads "Reseller › Service Providers" instead of
       stopping at the level. Strip a leading "<id>: " prefix some screenNames carry. */
    var curPage = "";
    if (!curEnt && !document.querySelector("a.navMenuItem")) {   /* skip on folder MENU/base pages (their anchor isn't a page) */
      var pn = (title.textContent || "").trim();
      var pci = pn.indexOf(": "); if (pci > 0 && pn.slice(0, pci).indexOf(" ") === -1) pn = pn.slice(pci + 2).trim();
      if (pn && (segs[segs.length - 1].textContent || "").trim() !== pn) curPage = pn;
    }

    for (var j = 0; j < segs.length; j++) {
      if (j > 0) {
        var sep = document.createElement("span");
        sep.className = "cp-bc-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.innerHTML = CP_BC_ARROW_SVG;
        bar.appendChild(sep);
      }
      var a = segs[j];
      var isCur = (j === segs.length - 1) && !curEnt && !curPage;   /* last level is current ONLY if there's no entity AND no page name */
      a.classList.add(isCur ? "cp-bc-cur" : "cp-bc-seg");
      if (isCur) {
        a.setAttribute("aria-current", "page");
        a.removeAttribute("href");
        a.onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); return false; };   /* current level = not a link */
      }
      bar.appendChild(a);   /* MOVES the real link out of the cell — ancestors keep their native onclick */
    }

    /* Append the entity as the current pill (matches the live "… Users : id"); .cp-bc-id keeps its case. */
    if (curEnt) {
      var esep = document.createElement("span");
      esep.className = "cp-bc-sep";
      esep.setAttribute("aria-hidden", "true");
      esep.innerHTML = CP_BC_ARROW_SVG;
      bar.appendChild(esep);
      var idPill = document.createElement("span");
      idPill.className = "cp-bc-cur cp-bc-id";
      idPill.setAttribute("aria-current", "page");
      idPill.textContent = curEnt;
      bar.appendChild(idPill);
    }

    /* Append the page name as the current pill on plain list/section pages (no entity). */
    if (curPage) {
      var psep = document.createElement("span");
      psep.className = "cp-bc-sep";
      psep.setAttribute("aria-hidden", "true");
      psep.innerHTML = CP_BC_ARROW_SVG;
      bar.appendChild(psep);
      var pPill = document.createElement("span");
      pPill.className = "cp-bc-cur";
      pPill.setAttribute("aria-current", "page");
      pPill.textContent = curPage;
      bar.appendChild(pPill);
    }

    titleTable.parentNode.insertBefore(bar, titleTable);
    cell.style.display = "none";
    /* Destination-focus transition: only the current pill slides + pops in (matches the pjax crumb). */
    var animPill = bar.querySelector(".cp-bc-cur");
    if (animPill) requestAnimationFrame(function () {
      try { animPill.animate([{ opacity: 0, transform: "scale(0.82) translateX(10px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(0.34,1.4,0.64,1)" }); } catch (e) {}
    });
  } catch (e) {
    console.warn("[CommPilot Skin] moveBreadcrumb:", e);
  }
}

/*
 * Move interactive elements from the bottom button bar into
 * .cp-results-box as an inner footer row.
 *
 * On list pages, the bottom OK/action bar (tr#buttonbarbottom)
 * previously sat as a separate box below the results.  This function
 * moves its interactive child nodes (input, button, a) into a
 * new <div class="cp-results-footer"> inside .cp-results-box,
 * then hides the original empty row so the footer reads as part
 * of the same unified box.
 *
 * Nodes are MOVED (not recreated) so their ids, handlers, and
 * inline event listeners survive.  Script blocks inside the bar
 * (redirectPost, goBack, etc.) remain in place — they've already
 * executed and their function definitions are globally accessible.
 *
 * Idempotent — safe to call multiple times.  Silently skipped on menu pages
 * (no .cp-results-box) or pages without a bottom button bar.
 */
function moveButtonBar() {
  try {
    var box = document.querySelector(".cp-results-box") || document.querySelector(".cp-search-box");
    if (!box) return;
    if (box.querySelector(".cp-results-footer")) return; /* already moved */

    var barRow = document.getElementById("buttonbarbottom");
    if (!barRow) return;

    var barTd = barRow.querySelector("td.buttonbar");
    if (!barTd) return;

    /* Create the footer div */
    var footer = document.createElement("div");
    footer.className = "cp-results-footer";

    /* Collect all interactive child nodes in the buttonbar td
       (input, button, a) and move them into the footer, preserving
       their original DOM order.  querySelectorAll returns a static
       NodeList, so iterating while moving nodes is safe. */
    var interactives = barTd.querySelectorAll("input, button, a");
    interactives.forEach(function (node) {
      footer.appendChild(node);
    });

    /* Append the footer as the last child of .cp-results-box */
    box.appendChild(footer);

    /* Hide the now-empty original row */
    barRow.style.display = "none";
  } catch (e) {
    console.warn("[CommPilot Skin] moveButtonBar:", e);
  }
}

function wrapResultsScroll() {
  try {
    var table = document.querySelector('table:has(> tbody > tr > td.listHeader > a.listSortHeader)');
    if (!table || !table.parentNode) return;
    if (table.parentNode.classList && table.parentNode.classList.contains("cp-results-scroll")) return; // idempotent
    var scroll = document.createElement("div");
    scroll.className = "cp-results-scroll";
    table.parentNode.insertBefore(scroll, table);
    scroll.appendChild(table);
  } catch (e) { console.warn("[CommPilot Skin] wrapResultsScroll:", e); }
}

function trimEditColumn() {
  try {
    var table = document.querySelector('table:has(> tbody > tr > td.listHeader > a.listSortHeader)');
    if (!table || table.dataset.cpEditTrimmed) return;
    table.dataset.cpEditTrimmed = "1";
    table.querySelectorAll("tr").forEach(function (row) {
      var cells = Array.prototype.slice.call(row.children);
      var lastMeaningful = -1;
      for (var i = 0; i < cells.length; i++) {
        if (cells[i].querySelector("a.tableLink, a.listSortHeader")) lastMeaningful = i;
      }
      if (lastMeaningful === -1) return; // not a data/header row — leave it alone
      for (var j = cells.length - 1; j > lastMeaningful; j--) cells[j].remove();
    });
  } catch (e) { console.warn("[CommPilot Skin] trimEditColumn:", e); }
}

function makeRowsClickable() {
  try {
    document.querySelectorAll("tr.unselected").forEach(function (row) {
      if (row.dataset.cpRowClick) return; // idempotent
      row.dataset.cpRowClick = "1";
      row.style.cursor = "pointer";
      row.addEventListener("click", function (e) {
        if (e.target.closest("a")) return; // real link clicked — let it handle, no double-fire
        var link = row.querySelector("a.tableLink, a.tableLinkHover");
        if (link) link.click();
      });
    });
  } catch (e) { console.warn("[CommPilot Skin] makeRowsClickable:", e); }
}

/*
 * Restyle legacy status banners (.error / .warning / .informational) into
 * Trifecta alert cards with badge icon, title, body, and code chip.
 */
/* ---- alert-card helpers (shared by restyleAlerts + suppressEmptyResults) ---- */
function alertSeverityMeta(cls) {
  if (cls === "error") return { severity: "error", defaultTitle: "Something went wrong" };
  if (cls === "warning") return { severity: "warning", defaultTitle: "Heads up" };
  return { severity: "info", defaultTitle: "Notice" };
}
function alertBuildSvgIcon(severity) {
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "currentColor");
  var d;
  if (severity === "error") {
    d = "M10 2.5a1.5 1.5 0 0 1 1.31.75l7.01 12.25A1.5 1.5 0 0 1 17.01 17H2.99a1.5 1.5 0 0 1-1.31-2.25L8.69 3.25A1.5 1.5 0 0 1 10 2.5zm0 2.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 10 5zm0 7.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z";
  } else if (severity === "warning") {
    d = "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 2.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V7a.75.75 0 0 1 .75-.75zM10 12.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z";
  } else {
    d = "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 2.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm-.5 3.5a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-.75-.75z";
  }
  var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}
function alertAddThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/* Build a .cp-alert element (badge + title + body + optional code chip). */
function cpBuildAlert(severity, title, body, code) {
  var card = document.createElement("div");
  card.className = "cp-alert cp-alert-" + severity;
  card.title = body;
  var badge = document.createElement("span");
  badge.className = "cp-alert-badge";
  badge.appendChild(alertBuildSvgIcon(severity));
  card.appendChild(badge);
  var content = document.createElement("div");
  content.className = "cp-alert-content";
  var titleEl = document.createElement("div");
  titleEl.className = "cp-alert-title";
  titleEl.textContent = title;
  content.appendChild(titleEl);
  var bodyEl = document.createElement("div");
  bodyEl.className = "cp-alert-body";
  bodyEl.textContent = body;
  content.appendChild(bodyEl);
  card.appendChild(content);
  if (code) {
    var chip = document.createElement("span");
    chip.className = "cp-alert-chip";
    chip.textContent = code;
    card.appendChild(chip);
  }
  return card;
}
/* Insert an alert card at the top of the content cell with grow-in animation. */
function cpInsertTopAlert(card) {
  try {
    var searchBox = document.querySelector(".cp-search-box");
    var parent, ref;
    if (searchBox) { parent = searchBox.parentNode; ref = searchBox; }
    else {
      parent = document.querySelector('td[width="82%"]');
      ref = parent ? parent.firstChild : null;
    }
    if (!parent) return;
    parent.insertBefore(card, ref);
    var topCard = parent.querySelector(".cp-alert");
    if (topCard) {
      var sib = topCard.previousSibling;
      while (sib) {
        if (sib.nodeType === 8) { sib = sib.previousSibling; continue; }
        if (sib.nodeType === 3) {
          if (/^\s*$/.test(sib.nodeValue)) { sib = sib.previousSibling; continue; }
          break;
        }
        if (sib.nodeType === 1) {
          var tag = (sib.tagName || "").toLowerCase();
          if (tag === "br") { sib.style.setProperty("display", "none", "important"); sib = sib.previousSibling; continue; }
          if (tag === "script" || tag === "style" || (tag === "input" && sib.type === "hidden")) { sib = sib.previousSibling; continue; }
          break;
        }
        break;
      }
      var allAlerts = parent.querySelectorAll(".cp-alert");
      for (var ai = 0; ai < allAlerts.length; ai++) allAlerts[ai].style.removeProperty("margin-top");
      var tips = document.querySelectorAll("td.tip");
      var tip = null;
      for (var ti = 0; ti < tips.length; ti++) {
        if (tips[ti].getBoundingClientRect().bottom <= topCard.getBoundingClientRect().top) tip = tips[ti];
      }
      if (tip) {
        /* Measure from the tip TEXT's ink rect, not the cell rect: td.tip
           is ~18px taller than its text (bottom padding + row stretch), so
           a cell-bottom gap reads far larger to the eye. 12px from the ink
           bottom visually matches the card's 12px bottom rhythm. */
        var inkRange = document.createRange();
        inkRange.selectNodeContents(tip);
        var inkRect = inkRange.getBoundingClientRect();
        var tipBottom = inkRect.height ? inkRect.bottom : tip.getBoundingClientRect().bottom;
        var gap = topCard.getBoundingClientRect().top - tipBottom;
        var delta = 12 - gap;
        if (Math.abs(delta) >= 1) topCard.style.setProperty("margin-top", delta + "px", "important");
      }
    }
    var h = card.getBoundingClientRect().height;
    if (h) {
      var prevOverflow = card.style.overflow;
      card.style.overflow = "hidden";
      var anim = card.animate(
        [
          { height: "0px", opacity: 0, marginBottom: "0px" },
          { height: h + "px", opacity: 1, marginBottom: "12px" }
        ],
        { duration: 360, easing: "cubic-bezier(0,0,0.2,1)" }
      );
      anim.onfinish = function () { card.style.overflow = prevOverflow; };
    }
  } catch (e) { console.warn("[CommPilot Skin] cpInsertTopAlert:", e); }
}

/*
 * Restyle legacy status banners (.error / .warning / .informational) into
 * Trifecta alert cards with badge icon, title, body, and code chip.
 */
function restyleAlerts() {
  try {
    var contentCell = document.querySelector('td[width="82%"]');
    if (!contentCell) return;

    var KNOWN_CODES = {
      "4027": { severity: "warning", title: "Too many results" }
    };

    /* Capture eligible banners and build cards. Iterate in reverse so
       cpInsertTopAlert (which inserts before .cp-search-box) preserves
       the original top-to-bottom document order: first banner on top. */
    var els = contentCell.querySelectorAll(".error, .warning, .informational");
    for (var idx = els.length - 1; idx >= 0; idx--) {
      var el = els[idx];
      try {
        if (el.dataset.cpAlert) continue;
        el.dataset.cpAlert = "1";

        var cls = "informational";
        if (el.classList.contains("error")) cls = "error";
        else if (el.classList.contains("warning")) cls = "warning";

        var text = (el.textContent || "").trim();
        if (text.length <= 20) continue;

        var codeStr = "", body = text, known = null;
        var m = /^(?:Failed to read:\s*)?\[(Error|Warning)\s+(\d+)\]\s*(.*)/i.exec(text);
        if (m) {
          codeStr = m[1] + " " + m[2];
          known = KNOWN_CODES[m[2]];
          if (known) cls = known.severity;
          body = m[3] || "";
          if (body) body = body.charAt(0).toUpperCase() + body.slice(1);
        }

        body = body.replace(/\b(\d{4,})\b/g, function (s) { return alertAddThousands(s); });

        var meta = alertSeverityMeta(cls);
        var card = cpBuildAlert(meta.severity, known ? known.title : meta.defaultTitle, body, codeStr || null);
        card.title = text;

        el.classList.add("cp-alert-host");
        el.innerHTML = "";

        cpInsertTopAlert(card);
      } catch (e) {
        console.warn("[CommPilot Skin] restyleAlerts item:", e);
      }
    }
  } catch (e) { console.warn("[CommPilot Skin] restyleAlerts:", e); }
}

/*
 * Suppress the results box when search returns zero matches. Hide the box,
 * reset the reveal-state flag, and show a "No results" info alert card.
 */
function suppressEmptyResults() {
  try {
    /* Clean up any stale [data-cp-empty] alert from a previous empty search. */
    var stale = document.querySelector('.cp-alert[data-cp-empty]');
    if (stale) stale.remove();

    var box = document.querySelector(".cp-results-box");
    if (!box) return;

    var cells = box.querySelectorAll("td");
    var isEmpty = Array.prototype.some.call(cells, function (td) {
      return /^no entries present$/i.test(td.textContent.trim());
    });
    if (!isEmpty) return;

    /* Hide the box — suppresses pagination + OK footer too */
    box.classList.add("cp-empty");

    /* Let the next non-empty search get its grow-in reveal */
    cpResultsWasVisible = false;

    /* Insert "No results" info alert */
    var card = cpBuildAlert("info", "No results", "No entries matched your search. Adjust the criteria and try again.");
    card.setAttribute("data-cp-empty", "");
    cpInsertTopAlert(card);
  } catch (e) { console.warn("[CommPilot Skin] suppressEmptyResults:", e); }
}

/*
 * Help mode toggle + tooltip overlay.
 *
 * Fetches help-content.json (declared in web_accessible_resources so it's
 * exempt from the page's CSP), then wires the sidebar Help button as a
 * toggle.  When help mode is ON, hovering a recognised content-menu link
 * (a.navMenuItem[name]) or left-nav folder (a.leftnavfolder / a.leftnavfolderopen)
 * shows a themed popover with the matching entry's title + body.
 *
 * The Help click is intercepted via a capture-phase listener so the page's
 * launchHelp() handler in the bubble phase does NOT fire.
 * Home / Logout are untouched.
 */
(async function setupHelpMode() {
  let helpData = null;
  let helpMode = false;
  let tooltipEl = null;
  let hoverTimer = null;
  let currentHelpSource = null;

  /* ---------- load help content ---------- */
  try {
    const url = chrome.runtime.getURL("assets/help/help-content.json");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    helpData = await resp.json();
  } catch (e) {
    console.warn("[CommPilot Skin] help-content unavailable:", e);
    return;
  }

  /* ---------- reusable tooltip element ---------- */
  function createTooltip() {
    const el = document.createElement("div");
    el.className = "cp-help-tip";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
    return el;
  }

  function showTooltip(entry, cx, cy) {
    if (!tooltipEl) tooltipEl = createTooltip();
    tooltipEl.innerHTML =
      '<div class="cp-help-tip-title">' +
      escapeHtml(entry.title) +
      '</div><div class="cp-help-tip-body">' +
      escapeHtml(entry.body) +
      "</div>";

    /* Position before making visible so clamping uses the correct layout */
    tooltipEl.style.left = "0px";
    tooltipEl.style.top = "0px";
    var rect = tooltipEl.getBoundingClientRect();
    /* scrollbar-gutter: both-edges insets the fixed-position origin by the
       left gutter while cursor coords stay viewport-true — subtract it.
       (html rect left == the gutter width; 0 when there is no gutter.) */
    var gutter = document.documentElement.getBoundingClientRect().left;
    var x = cx + 15 - gutter;
    var y = cy + 15;
    if (x + rect.width > window.innerWidth - 10) x = cx - rect.width - 15;
    if (y + rect.height > window.innerHeight - 10) y = cy - rect.height - 15;
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = y + "px";

    /* Trigger the fade+scale transition */
    tooltipEl.classList.add("cp-tip-visible");
  }

  function hideTooltip() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (tooltipEl) tooltipEl.classList.remove("cp-tip-visible");
  }

  /* minimal HTML escape */
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ---------- toggle ---------- */
  function toggleHelpMode() {
    helpMode = !helpMode;
    document.body.classList.toggle("cp-help-active", helpMode);
    var btn = document.querySelector(
      '.cp-footer-btn[data-cp-icon="help"]'
    );
    if (btn) btn.setAttribute("aria-pressed", String(helpMode));
    if (!helpMode) hideTooltip();
  }

  /* ---------- wire Help button (capture phase) ---------- */
  function wireHelpButton() {
    var btn = document.querySelector('.cp-footer-btn[data-cp-icon="help"]');
    if (!btn) return false;
    if (btn.dataset.cpHelpWired) return true;
    btn.dataset.cpHelpWired = "1";
    btn.addEventListener(
      "click",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleHelpMode();
      },
      true
    );
    return true;
  }

  if (!wireHelpButton()) {
    /* Retry once in case the footer hasn't been populated yet */
    var retryTimer = setTimeout(function () {
      wireHelpButton();
    }, 500);
  }

  /* ---------- event delegation (mouseover / mouseout) ---------- */
  document.addEventListener(
    "mouseover",
    function (e) {
      if (!helpMode || !helpData) return;

      var target = e.target;
      var entry = null;
      var source = null;

      /* Direct hover over a content-menu link */
      var navLink = target.closest("a.navMenuItem[name]");
      if (navLink && helpData.byName) {
        var name = navLink.getAttribute("name");
        if (helpData.byName[name]) {
          entry = helpData.byName[name];
          source = navLink;
        }
      }

      /* Hover anywhere on a card — resolve via its inner link */
      if (!entry) {
        var card = target.closest(".cp-menu-card");
        if (card && helpData.byName) {
          var cardLink = card.querySelector("a.navMenuItem[name]");
          if (cardLink) {
            var name = cardLink.getAttribute("name");
            if (helpData.byName[name]) {
              entry = helpData.byName[name];
              source = card;
            }
          }
        }
      }

      /* Hover over a left-nav folder */
      if (!entry) {
        var folderLink = target.closest(
          "a.leftnavfolder, a.leftnavfolderopen"
        );
        if (folderLink && helpData.byText) {
          var text = folderLink.textContent.trim();
          if (helpData.byText[text]) {
            entry = helpData.byText[text];
            source = folderLink;
          }
        }
      }

      if (!entry) return;

      /* Normalise source to the card when the hovered element is inside one,
         so hovering the link vs. the description vs. the padding all map to
         the same source element and don't re-trigger. */
      if (source) {
        var cardParent = source.closest
          ? source.closest(".cp-menu-card")
          : null;
        if (cardParent) source = cardParent;
      }

      /* Same source already active — ignore to prevent flicker/re-position */
      if (source === currentHelpSource) return;
      currentHelpSource = source;

      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        showTooltip(entry, e.clientX, e.clientY);
      }, 120);
    },
    true
  );

  document.addEventListener(
    "mouseout",
    function (e) {
      if (!helpMode) return;

      var target = e.target;
      var related = e.relatedTarget;

      var container = target.closest(
        "a.navMenuItem[name], a.leftnavfolder, a.leftnavfolderopen, .cp-menu-card"
      );
      if (!container) return;

      /* Don't hide if moving within the same element */
      if (related && container.contains(related)) return;

      /* Don't hide if moving within the same card (e.g. link → description) */
      if (related) {
        var card = container.closest
          ? container.closest(".cp-menu-card")
          : null;
        if (card && card.contains(related)) return;
      }

      hideTooltip();
      currentHelpSource = null;
    },
    true
  );

  /* ============================================================
     Help-coverage DEBUG overlay (dev tool). Header toggle that
     colour-codes every help-eligible element by whether it has an
     entry in help-content.json (green = has, red = missing) and
     logs the uncovered keys to the console for authoring.
     ============================================================ */
  var debugMode = false;

  function scanHelpCoverage() {
    if (!helpData) return;
    var covered = [], missing = [];
    function mark(el, type, key, label) {
      var has =
        type === "name"
          ? !!(helpData.byName && helpData.byName[key])
          : !!(helpData.byText && helpData.byText[key]);
      el.classList.remove("cp-help-has", "cp-help-none");
      el.classList.add(has ? "cp-help-has" : "cp-help-none");
      (has ? covered : missing).push({ type: type, key: key, label: label });
    }
    document.querySelectorAll(".cp-menu-card").forEach(function (card) {
      var link = card.querySelector("a.navMenuItem[name]");
      if (link) mark(card, "name", link.getAttribute("name"), (link.textContent || "").trim());
    });
    document.querySelectorAll("a.navMenuItem[name]").forEach(function (link) {
      if (link.closest(".cp-menu-card")) return;
      mark(link, "name", link.getAttribute("name"), (link.textContent || "").trim());
    });
    document.querySelectorAll("a.leftnavfolder, a.leftnavfolderopen").forEach(function (link) {
      var t = (link.textContent || "").trim();
      mark(link, "text", t, t);
    });
    try {
      console.group("[CommPilot Skin] Help coverage — " + covered.length + " covered, " + missing.length + " missing");
      if (missing.length) {
        if (console.table) console.table(missing);
        else missing.forEach(function (m) { console.log("MISSING", m.type, m.key, "—", m.label); });
      }
      console.groupEnd();
    } catch (e) {}
  }

  function clearCoverageTags() {
    document.querySelectorAll(".cp-help-has, .cp-help-none").forEach(function (el) {
      el.classList.remove("cp-help-has", "cp-help-none");
    });
  }

  function toggleHelpDebug() {
    debugMode = !debugMode;
    document.body.classList.toggle("cp-help-debug", debugMode);
    var b = document.querySelector(".cp-help-debug-btn");
    if (b) b.setAttribute("aria-pressed", String(debugMode));
    if (debugMode) scanHelpCoverage();
    else clearCoverageTags();
  }

  function wireHelpDebugButton() {
    try { if (localStorage.getItem("cpHelpDebug") !== "1") return true; } catch (e) { return true; }
    if (location.pathname.indexOf("/Login/") !== -1) return true;
    if (document.querySelector(".cp-help-debug-btn")) return true;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cp-help-debug-btn";
    btn.textContent = "Help Coverage";
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleHelpDebug();
    }, true);
    document.body.appendChild(btn);
    return true;
  }

  if (!wireHelpDebugButton()) setTimeout(wireHelpDebugButton, 500);

  document.addEventListener("cp:reskin", function () {
    wireHelpDebugButton();
    if (debugMode) scanHelpCoverage();
  });
  cpWireHelpBodyFn = function cpWireHelpBody() { wireHelpButton(); wireHelpDebugButton(); };
})();

/*
 * Full-load reveal — fade out and remove the splash overlay that cloak.js
 * painted at document_start. Contentless stub pages (mid-recovery redirects)
 * keep the cloak up — they navigate away on their own, and revealing them
 * would flash the raw white stub.
 */
function cpRevealCloak() {
  try {
    var contentful = !!document.querySelector('td[width="82%"], form[name="loginForm"], a.navMenuItem, .navOptions');
    if (contentful) {
      try { sessionStorage.setItem("cp-stub-tries", "0"); } catch (e) {}
    }
    var o = document.getElementById("cp-cloak");
    if (!o) return;
    if (!contentful || document.documentElement.classList.contains("cp-stub-hold")) return;
    if (cpLoginMorphPending) {
      var MIN = 450;
      var elapsed = performance.now() - cpSplashShownAt;
      if (elapsed < MIN) { setTimeout(cpRevealCloak, MIN - elapsed); return; }
      cpLoginMorphPending = false;
      if (cpSplashPulseAnim) { try { cpSplashPulseAnim.cancel(); } catch (e) {} cpSplashPulseAnim = null; }
      var mk = o.querySelector(".cp-cloak-mark");
      if (mk && mk.animate) {
        mk.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.12)" }], { duration: 240, easing: "ease-in", fill: "forwards" });
      }
      var done = function () { try { o.remove(); } catch (e) {} };
      if (o.animate) {
        o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out" }).onfinish = done;
        setTimeout(done, 520);
      } else {
        done();
      }
      // Home arrival — gentle rise-in for the swapped app
      var container = document.querySelector('td[width="82%"]');
      if (!container) container = document.body;
      if (container && container.animate) {
        container.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(0,0,0.2,1)" });
      }
      return;
    }
    var isLoginPage = !!document.querySelector(".cp-login-card");
    var done = function () { try { o.remove(); } catch (e) {} if (isLoginPage) cpLoginEntrance(); };
    if (o.animate) {
      o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out" }).onfinish = done;
      setTimeout(done, 400);
    } else {
      done();
    }
    if (!isLoginPage) cpLoginEntrance();
  } catch (e) {}
}

/*
 * Stamp each left-nav FOLDER with a name-derived data-cp-icon key so injectAssetCss masks the right
 * glyph onto its ::before regardless of the folder's row position or level (reseller / SP / group /
 * user). Submenu sub-items (.cp-subitem) are <a> inside leftNavForm too but aren't folders, so skip
 * them. Unknown names fall back to the neutral folder glyph so a folder NEVER renders as a mask-less
 * solid colour square.
 */
function cpFolderIconKey(name) {
  var n = (name || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!n) return "unknown";
  if (n.indexOf("profile") !== -1) return "profile";
  if (n.indexOf("resource") !== -1) return "resources";
  if (n.indexOf("barring") !== -1) return "comm-barring";
  if (n.indexOf("callcontrol") !== -1) return "call-control";
  if (n.indexOf("incoming") !== -1) return "incoming-calls";
  if (n.indexOf("outgoing") !== -1) return "outgoing-calls";
  if (n.indexOf("messaging") !== -1) return "messaging";
  if (n.indexOf("application") !== -1) return "client-apps";
  if (n.indexOf("calling") !== -1) return "callingplan";
  if (n.indexOf("callcenter") !== -1) return "callcenter";
  if (n.indexOf("meetme") !== -1 || n.indexOf("conferenc") !== -1) return "meetme";
  if (n.indexOf("utilit") !== -1) return "utilities";
  if (n.indexOf("service") !== -1) return "services";
  // No match → the distinct "unknown" glyph (a ?), NOT the folder/resources icon — so a folder
  // that still needs a real glyph (e.g. a new level's folder) is obvious at a glance, not silently
  // borrowing another icon. Add a name case + iconFile entry when wiring that folder's real glyph.
  return "unknown";
}
function tagSidebarIcons() {
  var folders = document.querySelectorAll(
    'form[name="leftNavForm"] a.leftnavfolder:not(.cp-subitem), form[name="leftNavForm"] a.leftnavfolderopen:not(.cp-subitem)'
  );
  folders.forEach(function (a) {
    var name = (a.textContent || "").trim().split(/\n/)[0].trim();
    a.setAttribute("data-cp-icon", cpFolderIconKey(name));
  });
  // Console section-header glyphs — keyed by the section's name so SP/Group/User sections match too.
  document.querySelectorAll(".cp-console-head-ico").forEach(function (ico) {
    var nm = ico.parentNode && ico.parentNode.querySelector(".cp-console-head-name");
    if (nm) ico.setAttribute("data-cp-icon", cpFolderIconKey((nm.textContent || "").trim()));
  });
}

/*
 * Full-skin DOM pass — re-applies every DOM transformation to the current
 * document body. Called on initial page load and on "cp:morphed" when
 * stubguard swaps in a fresh body (zero-navigation login morph).
 * The relative call order matches the original top-level execution order.
 */
function cpSkinDomPass() {
  if (cpLogoutToLogin()) return; // /Logout/ → straight to the styled login (no card)
  wrapMenuCards();
  tagMenuColumns();
  tagSidebarIcons();
  moveHeaderLinks();
  cpWireHomeButton();
  cpWireLogoutButton();
  wireSortIcons();
  wirePaginationIcons();
  formatPageIndicator();
  enhanceSelects();
  staggerCards();
  wrapResultsBox();
  wrapSearchBox();
  buildLoginCard();
  cpWireLoginBody();
  cpMoveBreadcrumb();
  moveButtonBar();
  wrapResultsScroll();
  trimEditColumn();
  makeRowsClickable();
  suppressEmptyResults();
  revealResultsBox();
  restyleAlerts();
  cpRevealCloak();
  if (cpWireHelpBodyFn) cpWireHelpBodyFn();
  cpSaveRecoverToken(false);
}

/* Re-skin on body morph (zero-navigation login — future phase). */
document.addEventListener("cp:morphed", function () { cpSkinDomPass(); });
document.addEventListener("cp:loginsplash", function () { cpLoginSplash(); });

/* Initial skin pass on this document. */
cpSkinDomPass();
