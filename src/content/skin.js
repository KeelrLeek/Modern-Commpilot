// CP_DEBUG gates skin.js's dev-audit logs (this load stamp + the Help-coverage table). Enable with
// localStorage.cpDebug="1". Every per-feature try/catch WARN stays always-on. Isolated-world copy — separate
// from the pjax/stubguard MAIN-world flag; all read the same localStorage key so one toggle covers all three.
var CP_DEBUG = false;
try { CP_DEBUG = localStorage.getItem("cpDebug") === "1"; } catch (e) {}
function cpDbg() { if (CP_DEBUG) { try { console.log.apply(console, arguments); } catch (e) {} } }
cpDbg("[Modern CommPilot Skin] content script loaded");

// When the redesigned search grid (pjax MAIN) has taken over a list page it sets html.cp-grid-on; skin.js
// then SKIPS its in-place legacy list skinning (search box / results box / pagination / row-click) so the two
// don't fight over the same content cell. On a grid preload FAILURE pjax removes the class, restores the
// legacy markup, and fires cp:skinlegacy → the list functions run (gate open) so the user is never stranded.
function cpGridOn() { try { return document.documentElement.classList.contains("cp-grid-on"); } catch (e) { return false; } }

// The reload-recovery store (cpRecoverNav + cpRecoverToken) is read back by cloak.js to re-POST the last page
// after a DNR reload-redirect. chrome.storage.local is GLOBAL across origins, so a single shared key let one
// host's nav/token bleed into another's recovery — visiting apps01 replayed the SANDBOX's absolute URL
// (apps-sbx.../Admins/Add) with a cross-host token → /Login/. Key the store PER-ORIGIN so each host only ever
// recovers its own page, and store the nav PATH-ONLY so a replay can never target another host.
function cpRecoverKey(base) { try { return base + ":" + location.origin; } catch (e) { return base; } }

function cpSaveRecoverToken(resetTries) {
  try {
    if (location.pathname.indexOf("/Login/") !== -1 || document.querySelector('input[type=password]')) return;
    // Contentless redirect-stub pages carry a login-context token the server
    // rejects for app POSTs — saving it would poison the recovery store.
    if (!document.querySelector('td[width="82%"], a.navMenuItem, .navOptions')) return;
    var t = document.getElementsByName("formtokenserial")[0];
    if (t && t.value && chrome.storage) {
      var o = {}; o[cpRecoverKey("cpRecoverToken")] = t.value;
      if (resetTries) o[cpRecoverKey("cpRecoverTries")] = 0;
      chrome.storage.local.set(o);
    }
  } catch (e) {}
}
cpSaveRecoverToken(true);
document.addEventListener("cp:reskin", function () { cpSaveRecoverToken(false); });
setInterval(function () { cpSaveRecoverToken(false); }, 15000);
// Drop the legacy GLOBAL (non-namespaced) recovery keys that caused the apps01 <-> sandbox cross-host bleed.
try { if (chrome.storage && chrome.storage.local) chrome.storage.local.remove(["cpRecoverNav", "cpRecoverToken", "cpRecoverTries"]); } catch (e) {}

window.addEventListener("message", function (e) {
  try {
    if (e.source === window && e.data && e.data.__cpRecoverNav && chrome.storage) {
      var nav = e.data.__cpRecoverNav;
      // Strip any origin so the stored nav is a same-host PATH (defence against cross-host replay).
      try { if (nav && typeof nav.url === "string") nav = { url: nav.url.replace(/^https?:\/\/[^\/]+/, ""), params: nav.params }; } catch (e2) {}
      var o = {}; o[cpRecoverKey("cpRecoverNav")] = nav;
      chrome.storage.local.set(o);
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
/* Per-item menu icons, keyed by the item's (lowercased) title. An entry is added as each page's
 * redesign is completed; items WITHOUT an entry render a dashed placeholder badge — so the icon's
 * presence doubles as the "this page is done" tracker. Mirrored onto the sidebar sub-items by
 * cpPopulateSubmenu (pjax) reading the card's .cp-card-ico, so this map is the single source of truth. */
/* SVGs below are the VERBATIM official Tabler "outline" icon paths (fetched from the @tabler/icons source, NOT
 * hand-transcribed — redrawing them from memory produced a wrong building-community). To add an icon: fetch the
 * real SVG (e.g. cdn.jsdelivr.net/npm/@tabler/icons/icons/outline/<name>.svg) and paste its <path> elements as-is. */
var CP_ITEM_ICONS = {
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
  "identity/device profile types": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1l0 -2"/><path d="M4 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6"/><path d="M14 12l6 0"/><path d="M14 16l6 0"/><path d="M14 20l6 0"/></svg>'
};
function cpMenuItemIcon(title) {
  var t = (title || "").trim().toLowerCase();
  if (/^administrator (modify|add)$/.test(t)) t = "administrators";   // the edit/create form pages share the list icon
  if (/^identity\/device profile type (add|modify)$/.test(t)) t = "identity/device profile types";  // Add/Modify form → list icon (template)
  if (/^call recording platform (modify|add)$/.test(t)) t = "call recording platforms";  // Add/Modify form → list icon (audio-lines)
  if (/^device management device families (add|import|modify)$/.test(t)) t = "device management device families";  // Add/Import/Modify form → list icon (boxes)
  if (/^device management (tag sets|regions)( (add|add tag|modify|modify tag))?$/.test(t)) t = "device management tag sets";  // Tag Sets list/Modify + Add/Add Tag/Modify Tag + Regions Add → list icon (tags)
  return CP_ITEM_ICONS[t] || "";
}

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

      // Card HEAD = icon badge + (title/desc) on one row. The leaf summary (cpSummarizeLeaves) appends BELOW the
      // head as an in-card footer, so the card is a column: [head][summary].
      const head = document.createElement("div");
      head.className = "cp-card-head";

      // Icon badge (left): the item's assigned icon, or a dashed placeholder when not yet done.
      const svg = cpMenuItemIcon(anchor.textContent);
      const icoWrap = document.createElement("div");
      icoWrap.className = "cp-card-ico" + (svg ? "" : " cp-card-ico-todo");
      if (svg) icoWrap.innerHTML = svg;

      const main = document.createElement("div");
      main.className = "cp-card-main";

      const titleWrap = document.createElement("div");
      titleWrap.className = "cp-card-title";
      titleWrap.appendChild(anchor);

      const descWrap = document.createElement("div");
      descWrap.className = "cp-card-desc";
      descWrap.textContent = descTd.textContent;

      main.appendChild(titleWrap);
      main.appendChild(descWrap);

      head.appendChild(icoWrap);
      head.appendChild(main);
      card.appendChild(head);

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
    cpProfileForm();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin cpProfileForm", e);
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
    document.querySelectorAll(".cp-prof-rowc select").forEach(processSelect);
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
  if (cpGridOn()) return;
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
  if (cpGridOn()) return;
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
  if (cpGridOn()) return;
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
  // Orphaned content script (left over from an extension reload/update) → chrome.runtime is dead and
  // chrome.runtime.getURL below throws "Extension context invalidated". Bail so it no-ops instead of throwing.
  try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (e) { return; }
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
    sp.style.border = "2px solid rgba(198,168,232,0.35)"; sp.style.borderTopColor = "#C6A8E8"; sp.style.borderRadius = "50%"; sp.style.width = "14px"; sp.style.height = "14px"; sp.style.marginRight = "8px"; sp.style.verticalAlign = "-2px"; sp.style.display = "inline-block";
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
  // Per-property CSSOM, not setAttribute("style") — the page CSP (style-src 'nonce-…') blocks inline style
  // ATTRIBUTES but not CSSOM property writes. See [[gotcha-csp-inline-style-attr-blocked]].
  o.style.position = "fixed"; o.style.inset = "0"; o.style.zIndex = "2147483647"; o.style.background = "#1c1b19";
  o.style.display = "flex"; o.style.flexDirection = "column"; o.style.alignItems = "center"; o.style.justifyContent = "center";
  var mark = document.createElement("img");
  mark.className = "cp-cloak-mark";
  mark.src = chrome.runtime.getURL("assets/icons/trifecta-mark.svg");
  mark.style.width = "72px"; mark.style.height = "auto"; mark.style.opacity = "0";
  o.appendChild(mark);
  var word = document.createElement("div");
  word.className = "cp-cloak-word";
  word.style.font = "600 14px/1.4 'Nunito','Segoe UI',system-ui,sans-serif"; word.style.color = "#a4a29c"; word.style.marginTop = "14px"; word.style.opacity = "0";
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
  if (cpGridOn()) return;
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
  if (cpGridOn()) return;
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
  if (cpGridOn()) return;
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
  if (cpGridOn()) return;
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
  // Outline (stroked) glyphs — matches the form/console icon family + the approved alert style.
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  var markup;
  if (severity === "error") {
    markup = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>';
  } else if (severity === "warning") {
    markup = '<path d="M12 9v4"></path><path d="M10.24 3.957l-8.422 14.06a1.989 1.989 0 0 0 1.7 2.983h16.845a1.989 1.989 0 0 0 1.7 -2.983l-8.423 -14.06a1.989 1.989 0 0 0 -3.4 0z"></path><path d="M12 17h.01"></path>';
  } else {
    markup = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>';
  }
  svg.innerHTML = markup;
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
    // Settings FORM pages (cpProfileForm) mount their content in .cp-prof-scroll. Drop the alert at the TOP
    // of the form (after the page header, before the first card) so the server's error/success message shows
    // INSIDE the skinned layout instead of stranded in the legacy cell above the breadcrumb. cpProfileForm
    // runs before restyleAlerts, so the scroller already exists when the alert is built.
    var scroller = document.querySelector(".cp-prof-scroll");
    if (scroller) {
      var phead = scroller.querySelector(".cp-prof-head");
      scroller.insertBefore(card, phead ? phead.nextSibling : scroller.firstChild);
    } else {
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

        var codeStr = "", known = null;
        // Split off a leading action phrase ("Failed to add:", "Failed to save:") → use it as the TITLE,
        // so the banner reads "Failed to add" instead of the generic default.
        var pm = /^(Failed to \w+)\s*:?\s*([\s\S]*)$/i.exec(text);
        var prefixTitle = null, rest = text;
        if (pm) { prefixTitle = pm[1].charAt(0).toUpperCase() + pm[1].slice(1).toLowerCase(); rest = pm[2] || ""; }
        var body = rest;
        var m = /^\[(Error|Warning)\s+([\d,]+)\]\s*([\s\S]*)/i.exec(rest);
        if (m) {
          codeStr = m[1] + " " + m[2];
          known = KNOWN_CODES[m[2].replace(/,/g, "")];
          if (known) cls = known.severity;
          body = m[3] || "";
        }
        if (body) body = body.charAt(0).toUpperCase() + body.slice(1);
        body = body.replace(/\b(\d{4,})\b/g, function (s) { return alertAddThousands(s); });

        var meta = alertSeverityMeta(cls);
        var title = known ? known.title : (prefixTitle || meta.defaultTitle);
        var card = cpBuildAlert(meta.severity, title, body, codeStr || null);
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
  if (cpGridOn()) return;
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
      if (CP_DEBUG) {
        console.group("[CommPilot Skin] Help coverage — " + covered.length + " covered, " + missing.length + " missing");
        if (missing.length) {
          if (console.table) console.table(missing);
          else missing.forEach(function (m) { console.log("MISSING", m.type, m.key, "—", m.label); });
        }
        console.groupEnd();
      }
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
    // Reset the dead-session loop guard ONLY on a real app page (proof of a live session) — NOT on the
    // Login form. Resetting on Login defeats the guard: a logged-out host whose /Login/ → servlet/Login
    // bootstrap is caught by the DNR redirect would reset the counter every cycle and loop forever.
    // (cloak reveal still keys off `contentful`, which includes the login form, so the form stays visible.)
    var appPage = !!document.querySelector('td[width="82%"], a.navMenuItem, .navOptions');
    if (appPage) {
      try { sessionStorage.setItem("cp-stub-tries", "0"); } catch (e) {}
      try { sessionStorage.setItem("cp-err-retries", "0"); } catch (e) {}   // recovery succeeded → refresh the retry budget
      try { sessionStorage.removeItem("cp-replay-at"); } catch (e) {}
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

/* ============================================================
 * Reseller Profile settings form (Phase B — raw settings forms)
 * ============================================================
 * Transforms the legacy label:value <table> inside td.enduserbody into the
 * Trifecta "settings rows" card (Testing HTML Files/profile-redesign.html):
 * each row = label + description on the left, control on the right; the
 * read-only Reseller ID gets a copy button; OK/Apply/Cancel become a styled
 * action bar (Save primary / Apply secondary / Cancel ghost) that FORWARDS
 * clicks to the real hidden legacy buttons so submit semantics are unchanged.
 * The real Name <input> is MOVED (not recreated) so it stays inside the form
 * and submits normally. Shape-detected + idempotent — silently skips the
 * aggregated console, list pages, and any non-Profile page.
 */
var CP_PROF_COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"/><path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"/></svg>';
var CP_PROF_CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5l10 -10"/></svg>';
var CP_PROF_USER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/></svg>';
var CP_PROF_QR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M7 17l0 .01"/><path d="M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M7 7l0 .01"/><path d="M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M17 7l0 .01"/><path d="M14 14l3 0"/><path d="M20 14l0 .01"/><path d="M14 14l0 3"/><path d="M14 20l3 0"/><path d="M17 17l3 0"/><path d="M20 17l0 3"/></svg>';
var CP_PROF_ADJ_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M6 4v4"/><path d="M6 12v8"/><path d="M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M12 4v10"/><path d="M12 18v2"/><path d="M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M18 4v1"/><path d="M18 9v11"/></svg>';
var CP_PROF_SIGN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17c3.333 -3.333 5 -6 5 -8c0 -3 -1 -3 -2 -3s-2.032 1.085 -2 3c.034 2.048 1.658 4.877 2.5 6c1.5 2 2.5 2.5 3.5 1l2 -3c.333 2.667 1.333 4 3 4c.53 0 2.639 -2 3 -2c.517 0 1.517 .667 3 2"/></svg>';
var CP_PROF_TAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3"/></svg>';
var CP_PROF_VERIFY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06"/><path d="M15 19l2 2l4 -4"/></svg>';
var CP_PROF_INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/></svg>';
var CP_PROF_CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6"/></svg>';
var CP_PROF_EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/></svg>';
var CP_PROF_EYEOFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/><path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87"/><path d="M3 3l18 18"/></svg>';
var CP_PROF_X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>';
var CP_PROF_TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></svg>';
var CP_PROF_ALERT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/></svg>';
var CP_PROF_SERVER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3"/><path d="M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2"/><path d="M7 8l0 .01"/><path d="M7 16l0 .01"/></svg>';
var CP_PROF_REC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M7 12a5 5 0 0 1 5 -5"/><path d="M12 17a5 5 0 0 0 5 -5"/></svg>';
var CP_PROF_UPLOAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4v12"/></svg>';
/* single Tabler `tag` — the Tag-Set Add card-section icon. Deliberately NOT the reserved Lucide `tags` menu icon
 * (that's assigned only when the whole Tag Sets redesign is done — the icon-as-done-tracker rule). */
var CP_PROF_TAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3"/></svg>';
/* Tabler `map-pin` — the Device Management Regions Add card-section icon. */
var CP_PROF_REGION_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"/></svg>';
var CP_PROF_DESC = {
  "Reseller ID": "Unique identifier for this reseller. Read-only.",
  "Name": "Display name shown across the console."
};

function cpProfCopy(btn, text) {
  try { if (navigator.clipboard && text) navigator.clipboard.writeText(text); } catch (e) {}
  btn.classList.add("cp-prof-copied");
  btn.innerHTML = CP_PROF_CHECK_SVG;
  setTimeout(function () {
    btn.classList.remove("cp-prof-copied");
    btn.innerHTML = CP_PROF_COPY_SVG;
  }, 1300);
}

/* Per-page row builders. Each fills the card's rowsWrap and returns
 * { controls: [realEditableEls], sync?: fn } — `controls` drive the dirty
 * state; the optional `sync` re-mirrors real control state into the visuals.
 * Return null to abort (never leave a partial skin). */

/* Profile: label:value rows — read-only mono value + copy / moved styled input. */
function cpBuildProfileRows(rowsWrap, cell) {
  var rows = [];
  var trs = cell.querySelectorAll("tr");
  for (var i = 0; i < trs.length; i++) {
    var tds = [];
    for (var c = 0; c < trs[i].children.length; c++) {
      if (trs[i].children[c].tagName === "TD") tds.push(trs[i].children[c]);
    }
    if (tds.length < 2) continue;
    var label = (tds[0].textContent || "").trim();
    if (!label || label.length > 40 || !/:\s*$/.test(label)) continue;
    var ctrl = tds[1].querySelector("input, select, textarea");
    rows.push({ label: label.replace(/:\s*$/, ""), ctrl: ctrl, text: ctrl ? null : (tds[1].textContent || "").trim() });
  }
  if (!rows.length) return null;
  var editable = [];
  rows.forEach(function (r) {
    var row = document.createElement("div"); row.className = "cp-prof-row";
    var left = document.createElement("div"); left.className = "cp-prof-rowl";
    var k = document.createElement("div"); k.className = "cp-prof-k"; k.textContent = r.label;
    left.appendChild(k);
    var desc = CP_PROF_DESC[r.label];
    if (desc) { var d = document.createElement("div"); d.className = "cp-prof-d"; d.textContent = desc; left.appendChild(d); }

    var slot = document.createElement("div"); slot.className = "cp-prof-rowc";
    if (r.ctrl) {
      r.ctrl.classList.add("cp-prof-input");
      slot.appendChild(r.ctrl);                 // MOVE the real control (stays inside the form)
      editable.push(r.ctrl);
    } else {
      var rv = document.createElement("div"); rv.className = "cp-prof-roval";
      var txt = document.createElement("span"); txt.className = "cp-prof-rovaltxt"; txt.textContent = r.text;
      rv.appendChild(txt);
      var cp = document.createElement("button");
      cp.type = "button"; cp.className = "cp-prof-copy"; cp.setAttribute("aria-label", "Copy " + r.label);
      cp.innerHTML = CP_PROF_COPY_SVG;
      (function (val) { cp.addEventListener("click", function () { cpProfCopy(cp, val); }); })(r.text);
      rv.appendChild(cp);
      slot.appendChild(rv);
    }
    row.appendChild(left); row.appendChild(slot);
    rowsWrap.appendChild(row);
  });
  return { controls: editable };
}

/* Activation Code Device Onboarding Policies: useSystemSettings radio → two
 * choice cards; the two checkboxes → purple toggle switches. The choice cards
 * and toggles FORWARD-CLICK the real (hidden) legacy controls so submit + the
 * legacy enable/disable behaviour are unchanged; sync() MIRRORS the real state
 * (checked + disabled) back into the visuals, and dims the toggles under
 * "System" (the custom options only apply under "Reseller"). */
function cpBuildDapRows(rowsWrap, cell) {
  var sysR = cell.querySelector('input[name="useSystemSettings"][value="true"]');
  var resR = cell.querySelector('input[name="useSystemSettings"][value="false"]');
  var allowC = cell.querySelector('input[name="allowActivationRequestByUser"]');
  var emailC = cell.querySelector('input[name="sendActivationCodeInEmail"]');
  if (!sysR || !resR || !allowC || !emailC) return null;

  function sync() {
    cSys.classList.toggle("cp-prof-choice-on", sysR.checked);
    cRes.classList.toggle("cp-prof-choice-on", resR.checked);
    var custom = resR.checked;   // "Use reseller settings" = the options apply
    depRows.forEach(function (rec) {
      rec.tg.classList.toggle("cp-prof-toggle-on", rec.cb.checked);
      var dis = !custom || rec.cb.disabled;
      rec.tg.classList.toggle("cp-prof-toggle-dis", dis);
      rec.tg.setAttribute("aria-checked", rec.cb.checked ? "true" : "false");
      rec.row.classList.toggle("cp-prof-dim", dis);
    });
  }

  // settings-source row: two choice cards driving the real radios.
  var srcRow = document.createElement("div"); srcRow.className = "cp-prof-row cp-prof-srcrow";
  var srcK = document.createElement("div"); srcK.className = "cp-prof-k"; srcK.textContent = "Settings source"; srcRow.appendChild(srcK);
  var srcD = document.createElement("div"); srcD.className = "cp-prof-d";
  srcD.textContent = "Choose where this reseller's activation-code onboarding policy comes from."; srcRow.appendChild(srcD);
  var choices = document.createElement("div"); choices.className = "cp-prof-choices"; srcRow.appendChild(choices);
  function mkChoice(t, d, radio) {
    var c = document.createElement("div"); c.className = "cp-prof-choice";
    var ct = document.createElement("div"); ct.className = "cp-prof-choice-t";
    var dot = document.createElement("span"); dot.className = "cp-prof-choice-dot";
    ct.appendChild(dot); ct.appendChild(document.createTextNode(t));
    var cd = document.createElement("div"); cd.className = "cp-prof-choice-d"; cd.textContent = d;
    c.appendChild(ct); c.appendChild(cd);
    c.addEventListener("click", function () { radio.click(); sync(); });
    return c;
  }
  var cSys = mkChoice("Use system settings", "Inherit the platform default onboarding policy.", sysR);
  var cRes = mkChoice("Use reseller settings", "Define a custom policy with the options below.", resR);
  choices.appendChild(cSys); choices.appendChild(cRes);
  rowsWrap.appendChild(srcRow);

  // two toggle rows driving the real checkboxes.
  var depRows = [];
  function mkToggleRow(k, d, cb) {
    var row = document.createElement("div"); row.className = "cp-prof-row cp-prof-deprow";
    var left = document.createElement("div"); left.className = "cp-prof-rowl";
    var kk = document.createElement("div"); kk.className = "cp-prof-k"; kk.textContent = k; left.appendChild(kk);
    var dd = document.createElement("div"); dd.className = "cp-prof-d"; dd.textContent = d; left.appendChild(dd);
    var slot = document.createElement("div"); slot.className = "cp-prof-rowc cp-prof-togslot";
    var tg = document.createElement("span"); tg.className = "cp-prof-toggle";
    tg.setAttribute("role", "switch"); tg.setAttribute("tabindex", "0"); tg.setAttribute("aria-label", k);
    tg.addEventListener("click", function () { if (!tg.classList.contains("cp-prof-toggle-dis")) { cb.click(); sync(); } });
    tg.addEventListener("keydown", function (e) {
      if ((e.key === " " || e.key === "Enter") && !tg.classList.contains("cp-prof-toggle-dis")) { e.preventDefault(); cb.click(); sync(); }
    });
    slot.appendChild(tg);
    row.appendChild(left); row.appendChild(slot);
    rowsWrap.appendChild(row);
    depRows.push({ row: row, tg: tg, cb: cb });
  }
  mkToggleRow("Allow users to request an activation code", "Users can generate their own onboarding code instead of an admin issuing it.", allowC);
  mkToggleRow("Send activation code in email to user", "Email the activation code to the user automatically when it's generated.", emailC);

  return { controls: [sysR, allowC, emailC], sync: sync };
}

/* Administrator Modify: move the real legacy inputs (lastName / firstName / password /
 * echoPassword / language / disableAccount) into settings rows; surface the read-only
 * Administrator ID + Last Authentication; and add a LIVE password-requirements meter that
 * mirrors the server's Error-4813 rules (6–60 chars, 1 number/upper/lower/symbol, can't
 * contain the login ID) + a re-type match check, so admins don't round-trip the server to
 * find a weak password. Language reuses the site dropdown (enhanceSelects → .cp-dd). */
function cpBuildAdminRows(rowsWrap, cell) {
  var lastN = cell.querySelector('input[name="lastName"]');
  var firstN = cell.querySelector('input[name="firstName"]');
  var pw = cell.querySelector('input[name="password"]');
  var pw2 = cell.querySelector('input[name="echoPassword"]');
  var lang = cell.querySelector('select[name="language"]');
  var disable = cell.querySelector('input[name="disableAccount"]');
  if (!lastN || !firstN || !pw || !pw2) return null;
  // Add form: the Administrator ID is an EDITABLE input (userId); Modify has it as a read-only label.
  var userIdInput = cell.querySelector('input[name="userId"]');
  var isAdd = !!userIdInput;

  // Read-only text values from the legacy label rows (no input in the value cell).
  function legacyVal(re) {
    var trs = cell.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var tds = trs[i].querySelectorAll("td");
      if (tds.length >= 2 && re.test((tds[0].textContent || "").trim()) && !tds[1].querySelector("input,select,textarea")) {
        return (tds[1].textContent || "").trim();
      }
    }
    return "";
  }
  var adminId = legacyVal(/administrator\s*id/i);
  var lastAuth = legacyVal(/last\s*authentication/i);

  // 1. Administrator ID — editable input (Add) OR read-only mono value + copy (Modify).
  if (isAdd) {
    cpProfInput(userIdInput);
    var idRow = cpProfRow(rowsWrap, "Administrator ID", "Login ID for this administrator.", userIdInput);
    idRow.querySelector(".cp-prof-k").innerHTML = '<span class="cp-prof-req">*</span> Administrator ID';
  } else if (adminId) {
    var idv = document.createElement("div"); idv.className = "cp-prof-roval";
    var idt = document.createElement("span"); idt.className = "cp-prof-rovaltxt"; idt.textContent = adminId; idv.appendChild(idt);
    var idc = document.createElement("button"); idc.type = "button"; idc.className = "cp-prof-copy"; idc.setAttribute("aria-label", "Copy administrator ID"); idc.innerHTML = CP_PROF_COPY_SVG;
    (function (val) { idc.addEventListener("click", function () { cpProfCopy(idc, val); }); })(adminId);
    idv.appendChild(idc);
    cpProfRow(rowsWrap, "Administrator ID", "Login ID for this administrator. Read-only.", idv);
  }
  // 2 + 3. Names
  cpProfRow(rowsWrap, "Last name", "The administrator's last name.", cpProfInput(lastN));
  cpProfRow(rowsWrap, "First name", "The administrator's first name.", cpProfInput(firstN));

  // 4. Reset password (+ show toggle + live requirements meter)
  var pwslot = document.createElement("div");
  var pwwrap = document.createElement("div"); pwwrap.className = "cp-prof-pwwrap";
  cpProfInput(pw); pw.classList.add("cp-prof-pwinput");
  pwwrap.appendChild(pw);
  var eye = document.createElement("button"); eye.type = "button"; eye.className = "cp-prof-pweye"; eye.setAttribute("aria-label", "Show password"); eye.innerHTML = CP_PROF_EYE_SVG;
  eye.addEventListener("click", function () { var s = pw.type === "password"; pw.type = s ? "text" : "password"; eye.innerHTML = s ? CP_PROF_EYEOFF_SVG : CP_PROF_EYE_SVG; });
  pwwrap.appendChild(eye); pwslot.appendChild(pwwrap);
  var treat = document.createElement("div"); treat.className = "cp-prof-treat"; pwslot.appendChild(treat);
  var pwLabel = isAdd ? "Initial password" : "Reset password";
  var pwRow = cpProfRow(rowsWrap, pwLabel, isAdd ? "The administrator's initial sign-in password." : "Leave blank to keep the current password.", pwslot);
  pwRow.classList.add("cp-prof-pwrow");
  pwRow.querySelector(".cp-prof-k").innerHTML = '<span class="cp-prof-req">*</span> ' + pwLabel;

  // 5. Re-type new password (+ match)
  var p2slot = document.createElement("div");
  cpProfInput(pw2); p2slot.appendChild(pw2);
  var mat = document.createElement("div"); mat.className = "cp-prof-mat"; mat.style.display = "none"; p2slot.appendChild(mat);
  var rtLabel = isAdd ? "Re-type initial password" : "Re-type new password";
  var p2Row = cpProfRow(rowsWrap, rtLabel, "Enter the same password again to confirm.", p2slot);
  p2Row.classList.add("cp-prof-pwrow");
  p2Row.querySelector(".cp-prof-k").innerHTML = '<span class="cp-prof-req">*</span> ' + rtLabel;

  // 6. Language (real select → site dropdown via enhanceSelects)
  if (lang) { cpProfInput(lang); cpProfRow(rowsWrap, "Language", "Console display language for this administrator.", lang); }

  // 7. Last authentication (read-only)
  if (lastAuth) { var lav = document.createElement("div"); lav.className = "cp-prof-mval"; lav.textContent = lastAuth; cpProfRow(rowsWrap, "Last authentication", "When this administrator last signed in.", lav); }

  // 8. Disable account (toggle)
  var tg = null;
  if (disable) { tg = cpProfToggleEl(disable); cpProfRow(rowsWrap, "Disable account", "Block this administrator from signing in.", tg).classList.add("cp-prof-deprow"); }

  // --- live password requirements ---
  // login ID for the "can't contain the ID" rule: the live userId input on Add, the fixed ID on Modify.
  function getLoginId() { return isAdd ? (userIdInput.value || "") : (adminId || ""); }
  function evalPw(v) {
    var lid = getLoginId();
    return { len: v.length >= 6 && v.length <= 60, num: /[0-9]/.test(v), up: /[A-Z]/.test(v), lo: /[a-z]/.test(v), sp: /[^A-Za-z0-9]/.test(v),
             id: v.length === 0 || !lid || v.toLowerCase().indexOf(lid.toLowerCase()) === -1 };
  }
  function ckItem(label, met) { return '<div class="cp-prof-ck' + (met ? " cp-prof-ck-met" : "") + '"><span class="cp-prof-ci">' + (met ? CP_PROF_CHECK_SVG : "") + "</span>" + label + "</div>"; }
  function renderPw() {
    var v = pw.value, e = evalPw(v);
    var rs = [["6–60 characters", e.len], ["1 number", e.num], ["1 uppercase letter", e.up], ["1 lowercase letter", e.lo], ["1 symbol", e.sp], ["Doesn’t contain the ID", e.id]];
    var met = 0; rs.forEach(function (r) { if (r[1]) met++; });
    var col = met <= 2 ? "#e06c75" : (met < 5 ? "#d19a66" : "#98c379");
    var lab = v.length === 0 ? "—" : (met <= 2 ? "Weak" : (met < 5 ? "Fair" : "Strong"));
    var fill = Math.round(met / 6 * 4), bars = "", i;
    for (i = 0; i < 4; i++) bars += '<span class="cp-prof-bar"' + ((i < fill && v.length) ? ' style="background:' + col + '"' : "") + "></span>";
    var html = '<div class="cp-prof-str"><div class="cp-prof-bars">' + bars + '</div><span class="cp-prof-slab" style="color:' + (v.length ? col : "var(--cp-text-muted)") + '">' + lab + "</span></div>";
    html += rs.map(function (r) { return ckItem(r[0], r[1]); }).join("");
    treat.innerHTML = html;
    if (pw2.value.length) { mat.style.display = "flex"; var ok = pw2.value === v; mat.className = "cp-prof-mat " + (ok ? "cp-prof-mat-ok" : "cp-prof-mat-no"); mat.innerHTML = (ok ? CP_PROF_CHECK_SVG : CP_PROF_X_SVG) + "<span>" + (ok ? "Passwords match" : "Passwords don’t match") + "</span>"; }
    else { mat.style.display = "none"; }
  }
  pw.addEventListener("input", renderPw); pw2.addEventListener("input", renderPw);
  if (isAdd) userIdInput.addEventListener("input", renderPw);   // re-check "can't contain the ID" as the ID is typed
  renderPw();

  // Language → site dropdown (enhanceSelects now also scans .cp-prof-rowc selects).
  try { enhanceSelects(); } catch (e) {}

  return {
    controls: [userIdInput, lastN, firstN, pw, pw2, lang, disable].filter(Boolean),
    subject: adminId,
    sync: function () { if (tg && tg._sync) tg._sync(); }
  };
}

/* Destructive-action confirm modal — a fixed overlay with a danger card. Forwards the real legacy delete
 * click ONLY when the user confirms (the double-ask). Esc / backdrop / Cancel all dismiss. */
function cpProfConfirmDelete(entity, subject, realDelete, detail) {
  try {
    document.querySelectorAll(".cp-prof-modalov").forEach(function (o) { o.remove(); });
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    var subj = subject ? "<b>" + esc(subject) + "</b>" : ("this " + esc(entity));
    var ov = document.createElement("div"); ov.className = "cp-prof-modalov";
    ov.innerHTML =
      '<div class="cp-prof-modal" role="dialog" aria-modal="true" aria-label="Confirm delete">' +
        '<div class="cp-prof-modalic">' + CP_PROF_ALERT_SVG + "</div>" +
        '<div class="cp-prof-modaltt">Delete this ' + esc(entity) + "?</div>" +
        '<div class="cp-prof-modalmsg">This permanently removes ' + subj + (detail ? " " + esc(detail) : "") + ". This can’t be undone.</div>" +
        '<div class="cp-prof-modalacts">' +
          '<button type="button" class="cp-prof-btn cp-prof-ghost" data-cp="cancel">Cancel</button>' +
          '<button type="button" class="cp-prof-btn cp-prof-dangersolid" data-cp="confirm">' + CP_PROF_TRASH_SVG + "<span>Delete " + esc(entity) + "</span></button>" +
        "</div>" +
      "</div>";
    function close() { try { ov.remove(); } catch (e) {} document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector('[data-cp="cancel"]').addEventListener("click", close);
    ov.querySelector('[data-cp="confirm"]').addEventListener("click", function () { close(); try { realDelete.click(); } catch (e) {} });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    var conf = ov.querySelector('[data-cp="confirm"]'); if (conf) conf.focus();
  } catch (e) { console.warn("[CommPilot Skin] confirm-delete:", e); }
}

/* ---- shared widget helpers (used by multi-card builders like STIR-SHAKEN) ---- */
function cpProfCard(label, icon) {
  var card = document.createElement("div"); card.className = "cp-prof-card";
  var head = document.createElement("div"); head.className = "cp-prof-cardhead";
  head.innerHTML = (icon || "") + "<span>" + label + "</span>";
  card.appendChild(head);
  var rows = document.createElement("div"); rows.className = "cp-prof-rows";
  card.appendChild(rows);
  return { card: card, rows: rows };
}
function cpProfRow(rows, k, d, ctrl, opts) {
  opts = opts || {};
  var row = document.createElement("div");
  row.className = "cp-prof-row cp-prof-ctrlrow" + (opts.sub ? " cp-prof-subrow" : "");
  var left = document.createElement("div"); left.className = "cp-prof-rowl";
  var kk = document.createElement("div"); kk.className = "cp-prof-k"; kk.textContent = k; left.appendChild(kk);
  if (d) { var dd = document.createElement("div"); dd.className = "cp-prof-d"; dd.textContent = d; left.appendChild(dd); }
  var slot = document.createElement("div"); slot.className = "cp-prof-rowc";
  if (ctrl) slot.appendChild(ctrl);
  row.appendChild(left); row.appendChild(slot);
  rows.appendChild(row);
  return row;
}
function cpProfInput(inputEl) { if (inputEl) inputEl.classList.add("cp-prof-input"); return inputEl; }
/* Wrap a real <input type=file> in a themed drop-zone (dashed box + upload icon + browse + filename). The real
 * input is visually hidden but kept in the form (it still submits multipart); click/Enter/drop all feed it. */
function cpBuildDropzone(fileI) {
  var dz = document.createElement("div");
  dz.className = "cp-prof-dz";
  dz.setAttribute("role", "button"); dz.setAttribute("tabindex", "0"); dz.setAttribute("aria-label", "Choose a file to upload");
  fileI.classList.add("cp-prof-dz-input");
  var ico = document.createElement("div"); ico.className = "cp-prof-dz-ico"; ico.innerHTML = CP_PROF_UPLOAD_SVG;
  var txt = document.createElement("div"); txt.className = "cp-prof-dz-txt";
  var main = document.createElement("div"); main.className = "cp-prof-dz-main";
  main.innerHTML = 'Drag a file here, or <span class="cp-prof-dz-browse">browse</span>';
  var fn = document.createElement("div"); fn.className = "cp-prof-dz-file"; fn.textContent = "No file chosen";
  txt.appendChild(main); txt.appendChild(fn);
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "cp-prof-dz-btn"; btn.textContent = "Browse";
  dz.appendChild(ico); dz.appendChild(txt); dz.appendChild(btn); dz.appendChild(fileI);
  function sync() {
    var f = fileI.files && fileI.files[0];
    fn.textContent = f ? f.name : "No file chosen";
    dz.classList.toggle("cp-prof-dz-has", !!f);
  }
  dz.addEventListener("click", function (e) { if (e.target === fileI) return; fileI.click(); });
  dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileI.click(); } });
  fileI.addEventListener("change", sync);
  dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("cp-prof-dz-over"); });
  dz.addEventListener("dragleave", function () { dz.classList.remove("cp-prof-dz-over"); });
  dz.addEventListener("drop", function (e) {
    e.preventDefault(); dz.classList.remove("cp-prof-dz-over");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      try { fileI.files = e.dataTransfer.files; } catch (err) {}
      sync(); try { fileI.dispatchEvent(new Event("change", { bubbles: true })); } catch (err) {}
    }
  });
  sync();
  return dz;
}
function cpProfToggleEl(cbEl, onChange) {
  var tg = document.createElement("span"); tg.className = "cp-prof-toggle";
  tg.setAttribute("role", "switch"); tg.setAttribute("tabindex", "0");
  if (!cbEl) return tg;
  function fire() { if (tg.classList.contains("cp-prof-toggle-dis")) return; cbEl.click(); if (tg._sync) tg._sync(); if (onChange) onChange(); }
  tg.addEventListener("click", fire);
  tg.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); fire(); } });
  tg._sync = function () { tg.classList.toggle("cp-prof-toggle-on", cbEl.checked); };
  return tg;
}
function cpProfSeg(radioEls, labels, hints, onChange) {
  var s = document.createElement("div"); s.className = "cp-prof-seg";
  radioEls.forEach(function (r, i) {
    var b = document.createElement("button"); b.type = "button"; b.className = "cp-prof-segbtn";
    b.innerHTML = labels[i] + (hints && hints[i] ? ' <span class="cp-prof-seghint">' + hints[i] + '</span>' : '');
    b._radio = r;
    b.addEventListener("click", function () { if (s.classList.contains("cp-prof-seg-dis")) return; r.click(); if (onChange) onChange(); });
    s.appendChild(b);
  });
  s._sync = function () { Array.prototype.forEach.call(s.children, function (b) { b.classList.toggle("cp-prof-segbtn-on", b._radio.checked); }); };
  return s;
}
function cpProfCloseDd() { document.querySelectorAll(".cp-prof-dd.cp-prof-dd-open").forEach(function (d) { d.classList.remove("cp-prof-dd-open"); }); }
var cpProfDdWired = false;
function cpProfDdEnsure() { if (cpProfDdWired) return; cpProfDdWired = true; document.addEventListener("click", cpProfCloseDd); window.addEventListener("scroll", cpProfCloseDd, true); }
function cpProfDropdown(radioEls, labels, onChange) {
  var d = document.createElement("div"); d.className = "cp-prof-dd";
  var t = document.createElement("button"); t.type = "button"; t.className = "cp-prof-dd-trigger";
  var v = document.createElement("span"); v.className = "cp-prof-dd-v";
  var chev = document.createElement("span"); chev.className = "cp-prof-dd-chev"; chev.innerHTML = CP_PROF_CHEV_SVG;
  t.appendChild(v); t.appendChild(chev);
  var m = document.createElement("div"); m.className = "cp-prof-dd-menu";
  radioEls.forEach(function (r, i) {
    var op = document.createElement("div"); op.className = "cp-prof-dd-opt";
    op.innerHTML = CP_PROF_CHECK_SVG + "<span>" + labels[i] + "</span>";
    op._radio = r;
    op.addEventListener("click", function (e) { e.stopPropagation(); r.click(); d.classList.remove("cp-prof-dd-open"); if (onChange) onChange(); });
    m.appendChild(op);
  });
  t.addEventListener("click", function (e) {
    e.stopPropagation();
    if (d.classList.contains("cp-prof-dd-dis")) return;
    var wasOpen = d.classList.contains("cp-prof-dd-open");
    cpProfCloseDd();
    if (!wasOpen) {
      var r = t.getBoundingClientRect();
      m.style.top = (r.bottom + 4) + "px"; m.style.left = r.left + "px"; m.style.minWidth = r.width + "px";
      d.classList.add("cp-prof-dd-open");
    }
  });
  d.appendChild(t); d.appendChild(m);
  d._sync = function () {
    var sel = -1;
    Array.prototype.forEach.call(m.children, function (op, i) { var on = op._radio.checked; op.classList.toggle("cp-prof-dd-opt-on", on); if (on) sel = i; });
    v.textContent = sel >= 0 ? labels[sel] : (labels[0] || "");
  };
  return d;
}

/* STIR-SHAKEN: a big multi-card form — Configuration (System/Reseller choice cards) +
 * Signing / Tagging / Verification cards. Radio groups → pills (short) or dropdowns
 * (long labels); checkboxes → toggles; URL/UUID text → moved styled inputs. Controls
 * FORWARD-CLICK / MIRROR the real hidden legacy controls; sync() reflects real state +
 * applies the System dim + the nested dependencies. Returns multiple cards + a GLOBAL
 * action bar (the page submits as one form). */
function cpBuildStirRows(cell) {
  function R(name) { return Array.prototype.slice.call(cell.querySelectorAll('input[name="' + name + '"]')); }
  function C(name) { return cell.querySelector('input[name="' + name + '"]'); }
  var sysR = cell.querySelector('input[name="useSystemSettings"][value="true"]');
  var resR = cell.querySelector('input[name="useSystemSettings"][value="false"]');
  var signingPolicy = R("signingPolicy"), taggingPolicy = R("taggingPolicy"), verstat = R("verstatTag");
  var attest = R("attestationLevel"), tagFrom = R("tagFromOrPAI"), origid = R("origid");
  var verErr = R("verificationErrorHandling"), unsLvl = R("unscreenedTrunkGroupOriginationAttestationLevel");
  if (!sysR || !resR || signingPolicy.length < 2 || taggingPolicy.length < 2) return null;
  cpProfDdEnsure();

  var widgets = [], dimRules = [], controls = [];
  function reg(w) { if (w && w._sync) widgets.push(w); return w; }
  function ctl(el) { if (el && controls.indexOf(el) < 0) controls.push(el); return el; }
  function ctlAll(arr) { arr.forEach(ctl); }
  function crow(rows, k, d, w, opts) { var r = cpProfRow(rows, k, d, w, opts); reg(w); return r; }

  function sync() {
    var cu = resR.checked;
    cSys.classList.toggle("cp-prof-choice-on", sysR.checked);
    cRes.classList.toggle("cp-prof-choice-on", resR.checked);
    inh.classList.toggle("cp-prof-inherit-show", !cu);
    sectionCards.forEach(function (c) { c.classList.toggle("cp-prof-carddim", !cu); });
    widgets.forEach(function (w) { w._sync(); });
    dimRules.forEach(function (r) { r.row.classList.toggle("cp-prof-dim", r.fn(cu)); });
  }

  // --- Configuration card (System / Reseller choice cards) ---
  var cfgC = cpProfCard("Configuration", CP_PROF_ADJ_SVG);
  var srcRow = document.createElement("div"); srcRow.className = "cp-prof-row cp-prof-srcrow";
  var sK = document.createElement("div"); sK.className = "cp-prof-k"; sK.textContent = "Settings source"; srcRow.appendChild(sK);
  var sD = document.createElement("div"); sD.className = "cp-prof-d"; sD.textContent = "Inherit the system STIR-SHAKEN policy, or define reseller-level settings below."; srcRow.appendChild(sD);
  var choices = document.createElement("div"); choices.className = "cp-prof-choices"; srcRow.appendChild(choices);
  function mkChoice(t, dsc, radio) {
    var c = document.createElement("div"); c.className = "cp-prof-choice";
    var ct = document.createElement("div"); ct.className = "cp-prof-choice-t";
    var dot = document.createElement("span"); dot.className = "cp-prof-choice-dot";
    ct.appendChild(dot); ct.appendChild(document.createTextNode(t));
    var cd = document.createElement("div"); cd.className = "cp-prof-choice-d"; cd.textContent = dsc;
    c.appendChild(ct); c.appendChild(cd);
    c.addEventListener("click", function () { radio.click(); sync(); });
    return c;
  }
  var cSys = mkChoice("Use system settings", "Inherit the platform default policy.", sysR);
  var cRes = mkChoice("Use reseller settings", "Configure signing, tagging and verification.", resR);
  choices.appendChild(cSys); choices.appendChild(cRes);
  var inh = document.createElement("div"); inh.className = "cp-prof-inherit";
  inh.innerHTML = CP_PROF_INFO_SVG + '<span>The sections below follow the system policy. Switch to "Use reseller settings" to edit them.</span>';
  srcRow.appendChild(inh);
  cfgC.rows.appendChild(srcRow);
  ctl(sysR); ctl(resR);

  // --- Signing ---
  var sg = cpProfCard("Signing", CP_PROF_SIGN_SVG);
  crow(sg.rows, "Signing policy", "Which outbound calls get a signed Identity header.", cpProfDropdown(signingPolicy, ["Off", "All Eligible Calls", "Eligible Inter-Network Calls"], sync)); ctlAll(signingPolicy);
  var sgEmg = ctl(C("signEmergencyCalls")); crow(sg.rows, "Sign emergency calls", "Apply signing to 911/emergency calls.", cpProfToggleEl(sgEmg, sync));
  var sgURL = ctl(C("signingServiceURL")); crow(sg.rows, "Signing service URL", "Endpoint that signs the calls.", cpProfInput(sgURL));
  crow(sg.rows, "Attestation level", "How strongly the caller is vouched for.", cpProfSeg(attest, ["Full", "Partial", "Gateway"], ["A", "B", "C"], sync)); ctlAll(attest);
  var chkDir = ctl(C("checkDirectoryNumbersForAttestation")); crow(sg.rows, "Check directory numbers for attestation", "Validate the calling number before attesting.", cpProfToggleEl(chkDir, sync));
  var matchCb = ctl(C("matchUnassignedNumbersOnly"));
  var matchRow = crow(sg.rows, "Match unassigned numbers only", "Only attest numbers not assigned to a user.", cpProfToggleEl(matchCb, sync), { sub: true });
  dimRules.push({ row: matchRow, fn: function (cu) { return !cu || !(chkDir && chkDir.checked); } });
  crow(sg.rows, "Origination ID source", "Where the origid for signing comes from.", cpProfSeg(origid, ["OS Value", "UUID"], null, sync)); ctlAll(origid);
  var uuidIn = ctl(C("origUUID"));
  var uuidRow = crow(sg.rows, "Origination ID (UUID)", "The UUID used as the origination identifier.", cpProfInput(uuidIn), { sub: true });
  dimRules.push({ row: uuidRow, fn: function (cu) { return !cu || !(origid[1] && origid[1].checked); } });
  var unsSign = ctl(C("enableSigningForUnscreenedTrunkGroupOriginations")); crow(sg.rows, "Sign unscreened trunk-group originations", "Sign calls from unscreened trunk groups.", cpProfToggleEl(unsSign, sync));
  var unsLvlRow = crow(sg.rows, "Unscreened attestation level", "Attestation for unscreened trunk-group calls.", cpProfSeg(unsLvl, ["Full", "Partial", "Gateway"], ["A", "B", "C"], sync), { sub: true }); ctlAll(unsLvl);
  dimRules.push({ row: unsLvlRow, fn: function (cu) { return !cu || !(unsSign && unsSign.checked); } });

  // --- Tagging ---
  var tg = cpProfCard("Tagging", CP_PROF_TAG_SVG);
  crow(tg.rows, "Tagging policy", "Which inbound calls get a verstat tag.", cpProfDropdown(taggingPolicy, ["Off", "All Eligible Calls", "Eligible Intra-Network Calls"], sync)); ctlAll(taggingPolicy);
  var tgEmg = ctl(C("tagEmergencyCalls")); crow(tg.rows, "Tag emergency calls", "Apply tagging to 911/emergency calls.", cpProfToggleEl(tgEmg, sync));
  crow(tg.rows, "Tag from", "Which header to read the calling number from.", cpProfSeg(tagFrom, ["PAI", "From", "Both"], null, sync)); ctlAll(tagFrom);
  crow(tg.rows, "Verstat tag", "Which verification result to tag.", cpProfDropdown(verstat, ["TN-Validation-Passed", "TN-Validation-Failed", "No-TN-Validation"], sync)); ctlAll(verstat);
  var unsTag = ctl(C("enableTaggingForUnscreenedTrunkGroupOriginations")); crow(tg.rows, "Tag unscreened trunk-group originations", "Tag calls from unscreened trunk groups.", cpProfToggleEl(unsTag, sync));

  // --- Verification ---
  var vf = cpProfCard("Verification", CP_PROF_VERIFY_SVG);
  var enVer = ctl(C("enableVerification")); crow(vf.rows, "Enable verification", "Verify the Identity header on inbound calls.", cpProfToggleEl(enVer, sync));
  var verURLin = ctl(C("verificationServiceURL"));
  var verURLrow = crow(vf.rows, "Verification service URL", "Endpoint that verifies the calls.", cpProfInput(verURLin), { sub: true });
  var verErrRow = crow(vf.rows, "On verification error", "What to do when verification fails.", cpProfSeg(verErr, ["Abort", "Proceed"], null, sync), { sub: true }); ctlAll(verErr);
  var verSubs = [verURLrow, verErrRow];
  [["proxyVerstatToCNAMSubscribe", "Proxy verstat to CNAM subscribe"], ["useUnknownHeadersFromCNAMNotify", "Use unknown headers from CNAM notify"], ["verifyGETSCalls", "Verify GETS calls"]].forEach(function (p) {
    var c = ctl(C(p[0]));
    verSubs.push(crow(vf.rows, p[1], "", cpProfToggleEl(c, sync), { sub: true }));
  });
  verSubs.forEach(function (rw) { dimRules.push({ row: rw, fn: function (cu) { return !cu || !(enVer && enVer.checked); } }); });
  var incTag = ctl(C("includeTaggedHeadersToAccessSide")); crow(vf.rows, "Include tagged headers to access side", "Forward verstat headers toward the subscriber.", cpProfToggleEl(incTag, sync));
  var proxyId = ctl(C("proxyIdentityHeaderToAccessSide")); crow(vf.rows, "Proxy identity header to access side", "Forward the Identity header toward the subscriber.", cpProfToggleEl(proxyId, sync));

  var sectionCards = [sg.card, tg.card, vf.card];
  return { cards: [cfgC.card, sg.card, tg.card, vf.card], controls: controls, sync: sync, globalActions: true };
}

/* Call Recording Platform Add/Modify — grouped two-card form (Platform / Recording). Text inputs +
 * native selects (→ site dropdown via enhanceSelects) are MOVED into settings rows; the supportVideo
 * true/false radio pair becomes a purple toggle (On = record video). One global Save/Cancel bar. */
function cpBuildCrpRows(cell) {
  var nameI = cell.querySelector('input[name="name"]');
  var descI = cell.querySelector('input[name="description"]');
  var ipI = cell.querySelector('input[name="ipAddress"]');
  var portI = cell.querySelector('input[name="port"]');
  var transportS = cell.querySelector('select[name="transport"]');
  var mediaS = cell.querySelector('select[name="mediaStream"]');
  var schemaS = cell.querySelector('select[name="schemaVersion"]');
  var vidT = cell.querySelector('input[name="supportVideo"][value="true"]');
  var vidF = cell.querySelector('input[name="supportVideo"][value="false"]');
  var routeT = cell.querySelector('textarea[name="route"]');
  if (!nameI || !ipI) return null;

  var controls = [];
  function ctl(el) { if (el && controls.indexOf(el) < 0) controls.push(el); return el; }
  function req(row, label) { var k = row.querySelector(".cp-prof-k"); if (k) k.innerHTML = '<span class="cp-prof-req">*</span> ' + label; }

  // supportVideo true/false radio pair → purple toggle (On = "true"). cpProfToggleEl is checkbox-only, so
  // wrap the pair: toggling clicks whichever radio flips the state, and the visual mirrors the "true" radio.
  var vidTg = null;
  if (vidT && vidF) {
    vidTg = document.createElement("span"); vidTg.className = "cp-prof-toggle";
    vidTg.setAttribute("role", "switch"); vidTg.setAttribute("tabindex", "0"); vidTg.setAttribute("aria-label", "Support video recording");
    var fireVid = function () { (vidT.checked ? vidF : vidT).click(); vidTg._sync(); };
    vidTg.addEventListener("click", fireVid);
    vidTg.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); fireVid(); } });
    vidTg._sync = function () { vidTg.classList.toggle("cp-prof-toggle-on", vidT.checked); vidTg.setAttribute("aria-checked", vidT.checked ? "true" : "false"); };
    ctl(vidT);
  }

  // --- Platform card --- (every field carries a descriptor, matching the Activation-policy form)
  var pc = cpProfCard("Platform", CP_PROF_SERVER_SVG);
  req(cpProfRow(pc.rows, "Name", "A label to identify this recording platform.", cpProfInput(ctl(nameI))), "Name");
  if (descI) cpProfRow(pc.rows, "Description", "Optional notes describing this platform.", cpProfInput(ctl(descI)));
  var hostSlot = document.createElement("div"); hostSlot.className = "cp-prof-hostport";
  cpProfInput(ctl(ipI)); ipI.classList.add("cp-prof-host"); hostSlot.appendChild(ipI);
  if (portI) {
    var pl = document.createElement("span"); pl.className = "cp-prof-portlbl"; pl.textContent = "Port"; hostSlot.appendChild(pl);
    cpProfInput(ctl(portI)); portI.classList.add("cp-prof-port"); hostSlot.appendChild(portI);
  }
  req(cpProfRow(pc.rows, "Host name / IP address", "Address of the recording server, with an optional port.", hostSlot), "Host name / IP address");
  if (transportS) cpProfRow(pc.rows, "Transport", "Protocol used to reach the platform.", cpProfInput(ctl(transportS)));

  // --- Recording card ---
  var rc = cpProfCard("Recording", CP_PROF_REC_SVG);
  if (mediaS) cpProfRow(rc.rows, "Media stream", "Whether call audio is sent as one mixed or two separate streams.", cpProfInput(ctl(mediaS)));
  if (schemaS) cpProfRow(rc.rows, "Schema version", "Metadata format version used when sending recordings.", cpProfInput(ctl(schemaS)));
  if (vidTg) cpProfRow(rc.rows, "Support video recording", "Record video calls to this platform.", vidTg).classList.add("cp-prof-deprow");
  if (routeT) { cpProfInput(routeT); routeT.classList.add("cp-prof-ta"); cpProfRow(rc.rows, "Route", "Optional SIP route applied to recording requests.", ctl(routeT)).classList.add("cp-prof-tarow"); }

  try { enhanceSelects(); } catch (e) {}

  return {
    cards: [pc.card, rc.card],
    controls: controls,
    sync: function () { if (vidTg) vidTg._sync(); },
    globalActions: true
  };
}

/* Device Management Device Families ADD — one required field (device family name) in a single card. */
function cpBuildDeviceFamilyAddRows(cell) {
  var nameI = cell.querySelector('input[name="deviceFamilyName"]');
  if (!nameI) return null;
  var dc = cpProfCard("Device family", CP_PROF_SERVER_SVG);
  cpProfInput(nameI);
  var row = cpProfRow(dc.rows, "Device Family Name", "A unique name for this device family.", nameI);
  var k = row.querySelector(".cp-prof-k"); if (k) k.innerHTML = '<span class="cp-prof-req">*</span> Device Family Name';
  return { cards: [dc.card], controls: [nameI], subject: nameI.value || "", globalActions: true };
}

/* Device Management Device Families IMPORT — File-upload card (themed drop-zone over the real multipart file
 * input) + Options card (the three legacy checkboxes → purple toggles). The OK submit stays a native multipart
 * POST to /servlet/DeviceManagementImportServlet (a file upload can't ride pjax). */
function cpBuildDeviceFamilyImportRows(cell) {
  var fileI = cell.querySelector('input[type="file"][name="fileName"]');
  if (!fileI) return null;
  var dfOv = cell.querySelector('input[name="dfOverrideCheckBox"]');
  var dtUp = cell.querySelector('input[name="dtFileUpdateCheckBox"]');
  var tsOv = cell.querySelector('input[name="tsOverrideCheckBox"]');
  var controls = [];
  function ctl(el) { if (el && controls.indexOf(el) < 0) controls.push(el); return el; }

  var fc = cpProfCard("File upload", CP_PROF_UPLOAD_SVG);
  var dzRow = cpProfRow(fc.rows, "Upload file", "Select a device family file to import.", cpBuildDropzone(ctl(fileI)));
  dzRow.classList.add("cp-prof-dzrow");
  var fk = dzRow.querySelector(".cp-prof-k"); if (fk) fk.innerHTML = '<span class="cp-prof-req">*</span> Upload file';

  var oc = cpProfCard("Options", CP_PROF_ADJ_SVG);
  if (dfOv) cpProfRow(oc.rows, "Device Family Override", "Replace an existing device family that has the same name.", cpProfToggleEl(ctl(dfOv))).classList.add("cp-prof-deprow");
  if (dtUp) cpProfRow(oc.rows, "Device Type File Update", "Update device type files from the imported file.", cpProfToggleEl(ctl(dtUp))).classList.add("cp-prof-deprow");
  if (tsOv) cpProfRow(oc.rows, "Tag Set Override", "Replace existing tag sets with those in the imported file.", cpProfToggleEl(ctl(tsOv))).classList.add("cp-prof-deprow");

  return { cards: [fc.card, oc.card], controls: controls, globalActions: true };
}

/* Device Management Tag Sets Add — a single required field. SINGLE-card form: one row (Tag set name + the moved
 * real input). The shared header/card/action-bar/22px-inset come from cpProfileForm; the row needs a descriptor
 * (see [[feedback-every-form-field-needs-descriptor]]). */
function cpBuildTagSetAddRows(rowsWrap, cell) {
  var name = cell.querySelector('input[name="tagSetName"]');
  if (!name) return null;
  var row = cpProfRow(rowsWrap, "Tag set name",
    "A unique name for this set of device-configuration tags. Up to 30 characters.",
    cpProfInput(name));
  row.querySelector(".cp-prof-k").innerHTML = '<span class="cp-prof-req">*</span> Tag set name';
  return { controls: [name] };
}

/* Device Management Tag Sets MODIFY → Add Tag — adds a %TAG% to an existing tag set. Fields: read-only tag set
 * (display only), the %-wrapped Tag Name (the % are FIXED syntax — the moved input submits the BARE name, the
 * server wraps it as %name%), an Overridable checkbox → toggle, and the Tag Value. Every row gets a descriptor
 * (see [[feedback-every-form-field-needs-descriptor]]). */
function cpBuildTagAddRows(rowsWrap, cell) {
  var name = cell.querySelector('input[name="tagName"]');
  var value = cell.querySelector('input[name="tagValue"]');
  if (!name || !value) return null;
  var ovr = cell.querySelector('input[name="tagValueOverridable"]');

  // Read-only "Tag Set Name" — a legacy label row with no input (the set this tag is added to).
  var trs = cell.querySelectorAll("tr"), setName = "";
  for (var i = 0; i < trs.length; i++) {
    var tds = trs[i].querySelectorAll("td");
    if (tds.length >= 2 && /tag set name/i.test((tds[0].textContent || "").trim()) && !tds[1].querySelector("input,select,textarea")) {
      setName = (tds[1].textContent || "").trim(); break;
    }
  }
  if (setName) {
    var sv = document.createElement("div"); sv.className = "cp-prof-roval";
    var svt = document.createElement("span"); svt.className = "cp-prof-rovaltxt"; svt.textContent = setName; sv.appendChild(svt);
    cpProfRow(rowsWrap, "Tag set", "The tag set this tag is added to.", sv);
  }

  // Tag name — the % adornments are fixed syntax; the moved input submits the bare name inside the group.
  var pgrp = document.createElement("div"); pgrp.className = "cp-prof-pctgrp";
  var p1 = document.createElement("span"); p1.className = "cp-prof-pct"; p1.textContent = "%";
  var p2 = document.createElement("span"); p2.className = "cp-prof-pct"; p2.textContent = "%";
  cpProfInput(name); name.classList.add("cp-prof-pctinput");
  pgrp.appendChild(p1); pgrp.appendChild(name); pgrp.appendChild(p2);
  var nameRow = cpProfRow(rowsWrap, "Tag name", "The tag identifier between percent signs — e.g. %DEVICE_TYPE%.", pgrp);
  nameRow.querySelector(".cp-prof-k").innerHTML = '<span class="cp-prof-req">*</span> Tag name';

  var controls = [name, value], ovrTgl = null;
  if (ovr) {
    ovrTgl = cpProfToggleEl(ovr);
    cpProfRow(rowsWrap, "Overridable", "Allow device profiles to override this tag's value.", ovrTgl);
    controls.push(ovr);
  }
  cpProfRow(rowsWrap, "Tag value", "The value this tag expands to in the device configuration.", cpProfInput(value));

  return { controls: controls, sync: function () { if (ovrTgl && ovrTgl._sync) ovrTgl._sync(); } };
}

/* Device Management Regions Add — adds a region to an existing tag set. SINGLE-card: a read-only "Tag set"
 * context row (the set this region belongs to) + the required Region Name. Same family as the Tag Set / Tag
 * Add forms; every row gets a descriptor (see [[feedback-every-form-field-needs-descriptor]]). */
function cpBuildRegionAddRows(rowsWrap, cell) {
  var name = cell.querySelector('input[name="regionName"]');
  if (!name) return null;

  // Read-only "Tag Set Name" — a legacy label row with no input (the set this region belongs to).
  var trs = cell.querySelectorAll("tr"), setName = "";
  for (var i = 0; i < trs.length; i++) {
    var tds = trs[i].querySelectorAll("td");
    if (tds.length >= 2 && /tag set name/i.test((tds[0].textContent || "").trim()) && !tds[1].querySelector("input,select,textarea")) {
      setName = (tds[1].textContent || "").trim(); break;
    }
  }
  if (setName) {
    var sv = document.createElement("div"); sv.className = "cp-prof-roval";
    var svt = document.createElement("span"); svt.className = "cp-prof-rovaltxt"; svt.textContent = setName; sv.appendChild(svt);
    cpProfRow(rowsWrap, "Tag set", "The tag set this region belongs to.", sv);
  }

  var row = cpProfRow(rowsWrap, "Region name", "A unique name for this region within the tag set. Up to 64 characters.", cpProfInput(name));
  row.querySelector(".cp-prof-k").innerHTML = '<span class="cp-prof-req">*</span> Region name';
  return { controls: [name] };
}

/* Device Management Tag Sets Modify Tag — edit an existing tag. Tag Set + Tag Name are READ-ONLY (you can't rename
 * a tag — delete and re-add); only the Overridable toggle (newTagValueOverridable) + Tag Value (newTagValue) are
 * editable. The action bar auto-adds Delete (cell has input[name=delete]) → confirm uses subject = the tag name.
 * Every row gets a descriptor (see [[feedback-every-form-field-needs-descriptor]]). */
function cpBuildTagModifyRows(rowsWrap, cell) {
  var value = cell.querySelector('input[name="newTagValue"]');
  if (!value) return null;
  var ovr = cell.querySelector('input[name="newTagValueOverridable"]');

  function legacyVal(re) {
    var trs = cell.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var tds = trs[i].querySelectorAll("td");
      if (tds.length >= 2 && re.test((tds[0].textContent || "").trim()) && !tds[1].querySelector("input,select,textarea")) {
        return (tds[1].textContent || "").trim();
      }
    }
    return "";
  }
  function roRow(label, val, desc) {
    if (!val) return;
    var v = document.createElement("div"); v.className = "cp-prof-roval";
    var vt = document.createElement("span"); vt.className = "cp-prof-rovaltxt"; vt.textContent = val; v.appendChild(vt);
    cpProfRow(rowsWrap, label, desc, v);
  }
  var tagName = legacyVal(/tag name/i);
  roRow("Tag set", legacyVal(/tag set name/i), "The tag set this tag belongs to.");
  roRow("Tag name", tagName, "The tag identifier — read-only. Delete and re-add to rename.");

  var controls = [value], ovrTgl = null;
  if (ovr) {
    ovrTgl = cpProfToggleEl(ovr);
    cpProfRow(rowsWrap, "Overridable", "Allow device profiles to override this tag's value.", ovrTgl);
    controls.push(ovr);
  }
  cpProfRow(rowsWrap, "Tag value", "The value this tag expands to in the device configuration. Up to 256 characters.", cpProfInput(value));

  return { controls: controls, sync: function () { if (ovrTgl && ovrTgl._sync) ovrTgl._sync(); }, subject: tagName };
}

/* Identity/Device Profile Type Add — the big device-type form. FULL-COVERAGE multi-card skin:
 * Profile / Standard options / Capabilities (filterable pill cloud) / Signaling & reset / Device
 * configuration (a master `deviceConfigOption` 3-way seg that reveals the Device Management OR the Legacy
 * sub-card). Text inputs + selects are MOVED into rows (selects themed by enhanceSelects, invoked from sync
 * so it runs AFTER the dispatcher mounts the cards — idempotent); radio groups → cpProfSeg/cpProfDropdown and
 * checkboxes → cpProfToggleEl, all forward-clicking the real (hidden) legacy controls so submit + legacy JS
 * are unchanged. sync() mirrors real state, dims actualMaxCalls under "Unlimited", and shows/hides the config
 * sub-cards by the master toggle. One global Add/Cancel bar. Every surfaced row carries a descriptor
 * ([[feedback-every-form-field-needs-descriptor]]). RE map: [[project-devicetype-add-redesign]]. */
var CP_PROF_CHECKS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.615 20h-2.615a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8"/><path d="M14 19l2 2l4 -4"/><path d="M9 8h4"/><path d="M9 12h2"/></svg>';
var CP_PROF_SETTINGS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></svg>';
var CP_PROF_DCSEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10a7 7 0 1 0 14 0a7 7 0 0 0 -14 0"/><path d="M21 21l-6 -6"/></svg>';
/* The 38 capability checkboxes, in legacy DOM order → pill cloud. [name, label]. */
var CP_DEVICETYPE_CAPS = [
  ["registrationCapable", "Registration Capable"], ["authenticateRefer", "Authenticate REFER"],
  ["staticRegistrationCapable", "Static Registration Capable"], ["videoCapable", "Video Capable"],
  ["e164capable", "E164 Capable"], ["useHistoryInfoHeaderOnAccessSide", "Use History Info Header"],
  ["trusted", "Trusted"], ["routeAdvance", "Route Advance"], ["forwardingOverride", "Forwarding Override"],
  ["wirelessIntegration", "Wireless Integration"], ["conferenceDevice", "Conference Device"],
  ["PBXIntegration", "PBX Integration"], ["mobilityManagerDevice", "Mobility Manager Device"],
  ["addPCalledPartyId", "Add P-Called-Party-ID"], ["musicOnHoldDevice", "Music On Hold Device"],
  ["autoConfigSoftClient", "Auto Configuration Soft Client"],
  ["requiresBroadWorksDigitCollection", "Requires Cisco BroadWorks Digit Collection"],
  ["requiresBWCallWaitingTone", "Requires Cisco BroadWorks Call Waiting Tone"],
  ["requiresMWISubscription", "Requires MWI Subscription"], ["aocCapable", "Advice of Charge Capable"],
  ["supportCCMIMEType", "Support Call Center MIME Type"],
  ["supportEmergencyDisconnectControl", "Support Emergency Disconnect Control"],
  ["supportIdentityInUpdateAndReInvite", "Support Identity In UPDATE and Re-INVITE"],
  ["enableMonitoring", "Enable Monitoring"], ["rfc3398Support", "Support RFC 3398"],
  ["staticLineOrdering", "Static Line/Port Ordering"], ["supportClientSessionInfo", "Support Client Session Info"],
  ["supportCallInfoConferenceSubscriptionURI", "Support Call Info Conference Subscription URI"],
  ["supportRemotePartyInfo", "Support Remote Party Info"],
  ["supportVisualDeviceManagement", "Support Visual Device Management Redirect Link"],
  ["bypassMediaTreatment", "Bypass Media Treatment"], ["supportCauseParameter", "Support Cause Parameter"],
  ["supportCPCInOutboundFromHeader", "Support Calling Party Category In Outbound From Header"],
  ["verstatInPAIHeader", "Verstat In PAI Header"], ["verstatInFromHeader", "Verstat In From Header"],
  ["supportPreferredAutoAndForcedAnswer", "Support Preferred Auto-Answer And Forced Answer"],
  ["supportCiscoCallerIdDispositionHeader", "Support Cisco Caller Id Disposition Header"],
  ["verstatInHistoryInfoOrDiversionHeader", "Verstat In History-Info or Diversion Header"]
];
function cpBuildDeviceTypeAddRows(cell) {
  function R(n) { return Array.prototype.slice.call(cell.querySelectorAll('input[name="' + n + '"]')); }
  function C(n) { return cell.querySelector('[name="' + n + '"]'); }
  var nameI = C("deviceType");
  if (!nameI || !cell.querySelector('input[name="deviceConfigOption"]')) return null;   // shape guard
  cpProfDdEnsure();

  var controls = [], widgets = [], dimRules = [], cardVis = [];
  function ctl(el) { if (el && controls.indexOf(el) < 0) controls.push(el); return el; }
  function ctlAll(arr) { arr.forEach(ctl); }
  function reg(w) { if (w && w._sync) widgets.push(w); return w; }
  function crow(rows, k, d, w, opts) { var r = cpProfRow(rows, k, d, w, opts); reg(w); return r; }
  function subhead(rows, t) { var s = document.createElement("div"); s.className = "cp-prof-subhead"; s.textContent = t; rows.appendChild(s); return s; }
  function segR(name, labels) { var r = R(name); if (!r.length) return null; ctlAll(r); return cpProfSeg(r, labels, null, sync); }
  function ddR(name, labels) { var r = R(name); if (!r.length) return null; ctlAll(r); return cpProfDropdown(r, labels, sync); }
  function inp(name) { var el = C(name); if (!el) return null; ctl(el); return cpProfInput(el); }
  function segRow(rows, name, labels, k, d) { var w = segR(name, labels); if (w) crow(rows, k, d, w); return w; }
  function ddRow(rows, name, labels, k, d) { var w = ddR(name, labels); if (w) crow(rows, k, d, w); return w; }
  function inputRow(rows, name, k, d) { var el = inp(name); if (el) cpProfRow(rows, k, d, el); return el; }
  function toggleRow(rows, name, k, d) { var cb = C(name); if (!cb) return; ctl(cb); crow(rows, k, d, cpProfToggleEl(cb, sync)).classList.add("cp-prof-deprow"); }

  function sync() {
    try { enhanceSelects(); } catch (e) {}                       // theme moved selects post-mount (idempotent)
    widgets.forEach(function (w) { w._sync(); });
    dimRules.forEach(function (r) { r.el.classList.toggle(r.cls || "cp-prof-dim", r.fn()); });
    cardVis.forEach(function (cv) { cv.card.style.display = cv.fn() ? "" : "none"; });
  }

  // ---- Profile ----
  var pc = cpProfCard("Profile", CP_PROF_USER_SVG);
  var resId = "";
  Array.prototype.forEach.call(cell.querySelectorAll("td"), function (td) {
    if (resId) return;
    if (/^Reseller ID:?$/i.test((td.textContent || "").replace(/\s+/g, " ").trim())) {
      var nx = td.nextElementSibling; if (nx) resId = (nx.textContent || "").replace(/\s+/g, " ").trim();
    }
  });
  if (resId) {
    var rv = document.createElement("div"); rv.className = "cp-prof-roval";
    var rtx = document.createElement("span"); rtx.className = "cp-prof-rovaltxt"; rtx.textContent = resId; rv.appendChild(rtx);
    cpProfRow(pc.rows, "Reseller ID", "The reseller this profile type belongs to.", rv);
  }
  var dtRow = cpProfRow(pc.rows, "Identity/Device profile type", "A unique name for this profile type.", cpProfInput(ctl(nameI)));
  var dk = dtRow.querySelector(".cp-prof-k"); if (dk) dk.innerHTML = '<span class="cp-prof-req">*</span> Identity/Device profile type';
  inputRow(pc.rows, "signalingAddressType", "Signaling address type", "How the device's lines and ports are addressed.");

  // ---- Standard options ----
  var sc = cpProfCard("Standard options", CP_PROF_ADJ_SVG);
  var unl = R("unlimitedMaxCalls");
  if (unl.length) {
    ctlAll(unl);
    var pseg = cpProfSeg(unl, ["Unlimited", "Limited to"], null, sync); reg(pseg);
    var slot = document.createElement("div"); slot.className = "cp-prof-portrow"; slot.appendChild(pseg);
    var maxI = C("actualMaxCalls");
    if (maxI) { ctl(maxI); cpProfInput(maxI); maxI.classList.add("cp-prof-portnum"); slot.appendChild(maxI); dimRules.push({ el: maxI, cls: "cp-prof-input-dim", fn: function () { var u = !!(unl[0] && unl[0].checked); maxI.readOnly = u; return u; } }); }
    cpProfRow(sc.rows, "Number of ports", "Line/port capacity of the device.", slot);
  }
  ddRow(sc.rows, "earlyMedia", ["RTP – Session", "RTP – Early Session", "Local Ringback – No Early Media"], "Ringback tone / early media", "How early media and ringback are handled.");
  segRow(sc.rows, "authentication", ["Enabled", "Disabled"], "Authentication", "Whether the device must authenticate.");
  ddRow(sc.rows, "holdNormalization", ["Unspecified Address", "Inactive", "RFC3264"], "Hold normalization", "SDP treatment when a call is held.");

  // ---- Capabilities (filterable pill cloud) ----
  var cc = cpProfCard("Capabilities", CP_PROF_CHECKS_SVG);
  var cnt = document.createElement("span"); cnt.className = "cp-prof-capcount";
  var chead = cc.card.querySelector(".cp-prof-cardhead"); if (chead) chead.appendChild(cnt);
  var srch = document.createElement("div"); srch.className = "cp-prof-capsearch";
  srch.innerHTML = CP_PROF_DCSEARCH_SVG + '<input type="text" placeholder="Filter capabilities…" aria-label="Filter capabilities">';
  cc.rows.appendChild(srch);
  var cloud = document.createElement("div"); cloud.className = "cp-prof-cloud"; cc.rows.appendChild(cloud);
  var capEmpty = document.createElement("div"); capEmpty.className = "cp-prof-capempty"; capEmpty.textContent = "No capabilities match that filter."; capEmpty.style.display = "none"; cc.rows.appendChild(capEmpty);
  CP_DEVICETYPE_CAPS.forEach(function (pair) {
    var cb = C(pair[0]); if (!cb) return; ctl(cb);
    var pill = document.createElement("button"); pill.type = "button"; pill.className = "cp-prof-cappill"; pill.setAttribute("role", "switch");
    pill.innerHTML = '<span class="cp-prof-captick">' + CP_PROF_CHECK_SVG + '</span><span class="cp-prof-caplbl">' + pair[1] + '</span>';
    pill._cb = cb; pill._lbl = pair[1].toLowerCase();
    pill.addEventListener("click", function () { cb.click(); capSync(); });
    cloud.appendChild(pill);
  });
  function capSync() {
    var on = 0, tot = cloud.children.length;
    Array.prototype.forEach.call(cloud.children, function (p) { var c = p._cb.checked; p.classList.toggle("cp-prof-cappill-on", c); p.setAttribute("aria-checked", c ? "true" : "false"); if (c) on++; });
    cnt.textContent = on + " of " + tot + " enabled";
  }
  reg({ _sync: capSync });
  srch.querySelector("input").addEventListener("input", function (e) {
    var q = (e.target.value || "").toLowerCase(), v = 0;
    Array.prototype.forEach.call(cloud.children, function (p) { var m = p._lbl.indexOf(q) >= 0; p.style.display = m ? "" : "none"; if (m) v++; });
    capEmpty.style.display = v ? "none" : "block";
  });

  // ---- Signaling & reset ----
  var gc = cpProfCard("Signaling & reset", CP_PROF_SETTINGS_SVG);
  segRow(gc.rows, "resetEvent", ["reSync", "checkSync", "resetString", "Not supported"], "Reset event", "How the device is told to reload.");
  inputRow(gc.rows, "customResetString", "Reset string", "Sent when the reset event is “resetString”.");
  segRow(gc.rows, "trunkMode", ["User", "Pilot", "Proxy"], "Trunk mode", "Role of the device on the trunk.");
  segRow(gc.rows, "holdAnnouncementMethod", ["Inactive", "Bandwidth attributes"], "Hold announcement method", "How music-on-hold is signalled.");
  ddRow(gc.rows, "deviceCategory", ["Generic", "Hosted", "Client App", "Trunking", "Local Gateway"], "Device category", "Classifies the device for routing and features.");
  ddRow(gc.rows, "unscreenedPresentationIdentityPolicy", ["Profile Presentation Identity", "Unscreened Presentation Identity", "Unscreened Presentation Identity With Profile Domain"], "Unscreened presentation identity policy", "Identity used for unscreened calls.");
  inputRow(gc.rows, "configurationURL", "Web based configuration URL extension", "Appended to the device's web-config URL.");

  // ---- Device configuration (master toggle + conditional sub-cards) ----
  var dcc = cpProfCard("Device configuration", CP_PROF_SERVER_SVG);
  var dco = R("deviceConfigOption");
  ctlAll(dco);
  crow(dcc.rows, "Configuration source", "Whether the device is managed via tag sets or a configuration server.", cpProfSeg(dco, ["Not supported", "Device Management", "Legacy"], null, sync));
  var dcNote = document.createElement("div"); dcNote.className = "cp-prof-confignote";
  dcNote.innerHTML = CP_PROF_INFO_SVG + '<span>No device configuration. Choose <b>Device Management</b> or <b>Legacy</b> to manage the device via tag sets or a config server.</span>';
  dcc.rows.appendChild(dcNote);
  reg({ _sync: function () { dcNote.style.display = (dco[0] && dco[0].checked) ? "" : "none"; } });

  // ---- Device Management sub-card ----
  var dmc = cpProfCard("Device Management", CP_PROF_SERVER_SVG);
  subhead(dmc.rows, "Tag sets");
  ddRow(dmc.rows, "deviceConfiguration", ["No Tag Sets", "Use Default System Tag Set Only", "Use Default System Tag Set and Custom"], "Device configuration tag sets", "Which tag sets the device's configuration uses.");
  inputRow(dmc.rows, "tagSet", "Custom tag set", "Reseller tag set applied to this device type.");
  toggleRow(dmc.rows, "allowDeviceProfileCustomTag", "Allow Identity/Device Profiles to configure custom tags", "Profiles may define their own custom tags.");
  toggleRow(dmc.rows, "allowGroupCustomTag", "Allow Groups to configure custom tags", "Groups may define custom tags.");
  toggleRow(dmc.rows, "allowSpCustomTag", "Allow Enterprises/Service Providers to configure custom tags", "SPs/Enterprises may define custom tags.");
  subhead(dmc.rows, "Activation & onboarding");
  toggleRow(dmc.rows, "allowDeviceActivation", "Allow activation code onboarding", "Device can be onboarded with an activation code.");
  toggleRow(dmc.rows, "isActivationCodeThroughMessagingServer", "Send activation code request through messaging server", "Route the activation request via the messaging server.");
  inputRow(dmc.rows, "deviceModelToValidate", "Enforced device model", "Restrict onboarding to a specific model.");
  toggleRow(dmc.rows, "sendEmailUponDeviceResetFailure", "Send email on device reset failure", "Notify the user if a reset fails.");
  subhead(dmc.rows, "Device access");
  inputRow(dmc.rows, "deviceAccessProtocol", "Device access protocol", "Transport the configuration server uses.");
  inputRow(dmc.rows, "deviceAccessFqdn", "Device access FQDN", "Host of the configuration server.");
  inputRow(dmc.rows, "deviceAccessPort", "Device access port", "Port of the configuration server.");
  inputRow(dmc.rows, "deviceAccessContext", "Device access context name", "Context/path on the configuration server.");
  inputRow(dmc.rows, "deviceAccessUri", "Device access URI", "Full URI override (optional).");
  segRow(dmc.rows, "macAddressIn", ["HTTP request URI", "HTTP header", "Client certificate"], "MAC address in", "Where the device's MAC address is carried.");
  segRow(dmc.rows, "deviceAccessHttp", ["Basic", "Digest"], "Device access HTTP authentication", "Auth scheme for the configuration fetch.");
  toggleRow(dmc.rows, "macBasedAuthentication", "Authentication mode · MAC-based", "Allow MAC-based device authentication.");
  toggleRow(dmc.rows, "usernamePasswordAuthentication", "Authentication mode · Username & password", "Allow username/password device authentication.");
  toggleRow(dmc.rows, "bearerFileAuthentication", "Authentication mode · Bearer file", "Allow bearer-file device authentication.");
  inputRow(dmc.rows, "defaultDeviceLanguage", "Default device language", "Language sent to the device.");
  inputRow(dmc.rows, "defaultDeviceEncoding", "Default device encoding", "Character encoding for the configuration.");
  subhead(dmc.rows, "Auto provisioning");
  inputRow(dmc.rows, "autoLinkingDeviceType", "Device type used for automatic linking", "Profile type to auto-link discovered devices to.");
  inputRow(dmc.rows, "autoCreate", "Device profiles auto creation", "Auto-create profiles at this level.");
  ddRow(dmc.rows, "deviceAccessSupportLinks", ["Not supported", "Support link to device", "Support link to device and user", "Support links from devices"], "Support links", "Web-config support links exposed to the device.");
  cardVis.push({ card: dmc.card, fn: function () { return !!(dco[1] && dco[1].checked); } });

  // ---- Legacy configuration sub-card ----
  var lgc = cpProfCard("Legacy configuration", CP_PROF_TAG_SVG);
  segRow(lgc.rows, "legacyConfigType", ["2 config file", "3 config file"], "Legacy configuration type", "Number of configuration files generated.");
  subhead(lgc.rows, "Tag sets");
  ddRow(lgc.rows, "deviceConfigurationLegacy", ["No Tag Sets", "Use Default System Tag Set Only", "Use Default System Tag Set and Custom"], "Device configuration tag sets", "Which tag sets the legacy configuration uses.");
  inputRow(lgc.rows, "tagSetLegacy", "Custom tag set", "Reseller tag set applied to this device type.");
  toggleRow(lgc.rows, "allowDeviceProfileCustomTagLegacy", "Allow Identity/Device Profiles to configure custom tags", "Profiles may define their own custom tags.");
  toggleRow(lgc.rows, "allowGroupCustomTagLegacy", "Allow Groups to configure custom tags", "Groups may define custom tags.");
  toggleRow(lgc.rows, "allowSpCustomTagLegacy", "Allow Enterprises/Service Providers to configure custom tags", "SPs/Enterprises may define custom tags.");
  toggleRow(lgc.rows, "sendEmailUponDeviceResetFailureLegacy", "Send email on device reset failure", "Notify the user if a reset fails.");
  subhead(lgc.rows, "Device access");
  inputRow(lgc.rows, "deviceAccessUriLegacy", "Device access URI", "Configuration server URI.");
  inputRow(lgc.rows, "deviceAccessUsernameLegacy", "Device access username", "Credential for the configuration fetch.");
  inputRow(lgc.rows, "deviceAccessPasswordLegacy", "Device access password", "Credential for the configuration fetch.");
  inputRow(lgc.rows, "deviceAccessPasswordConfirmLegacy", "Re-type device access password", "Confirm the password.");
  segRow(lgc.rows, "macAddressInLegacy", ["HTTP request URI", "HTTP header", "Client certificate"], "MAC address in", "Where the device's MAC address is carried.");
  inputRow(lgc.rows, "httpHeaderFormatLegacy", "MAC address format", "HTTP header format string.");
  segRow(lgc.rows, "deviceAccessHttpLegacy", ["Basic", "Digest"], "Device access HTTP authentication", "Auth scheme for the configuration fetch.");
  toggleRow(lgc.rows, "macBasedAuthenticationLegacy", "Authentication mode · MAC-based", "Allow MAC-based device authentication.");
  toggleRow(lgc.rows, "usernamePasswordAuthenticationLegacy", "Authentication mode · Username & password", "Allow username/password device authentication.");
  cardVis.push({ card: lgc.card, fn: function () { return !!(dco[2] && dco[2].checked); } });

  return { cards: [pc.card, sc.card, cc.card, gc.card, dcc.card, dmc.card, lgc.card], controls: controls, sync: sync, globalActions: true };
}

/* Page config — picks the row builder (+ card-header label/icon for single-card pages).
 * Returns null for any page that isn't a configured settings form. */
function cpSettingsFormConfig(title, cell) {
  if (/^Profile$/.test(title)) {
    return { label: "Reseller information", icon: CP_PROF_USER_SVG, build: cpBuildProfileRows };
  }
  if (/^Administrator (Modify|Add)/i.test(title) && cell.querySelector('input[name="echoPassword"]')) {
    return { label: "Administrator", icon: CP_ITEM_ICONS["administrators"], build: cpBuildAdminRows, deleteMsg: "and revokes their access to the console" };
  }
  if (/Activation Code Device Onboarding/i.test(title) || cell.querySelector('input[name="allowActivationRequestByUser"]')) {
    return { label: "Onboarding policy", icon: CP_PROF_QR_SVG, build: cpBuildDapRows };
  }
  if (/STIR.?SHAKEN/i.test(title) || cell.querySelector('input[name="signingPolicy"]')) {
    return { multiCard: true, build: cpBuildStirRows };
  }
  if (/^Call Recording Platform (Add|Modify)/i.test(title) || (cell.querySelector('input[name="ipAddress"]') && cell.querySelector('select[name="transport"]'))) {
    return { multiCard: true, build: cpBuildCrpRows };
  }
  if (/Device Families (Add|Modify)/i.test(title) || cell.querySelector('input[name="deviceFamilyName"]')) {
    return { multiCard: true, build: cpBuildDeviceFamilyAddRows };
  }
  if (/Device Families Import/i.test(title) || cell.querySelector('input[type="file"][name="fileName"]')) {
    return { multiCard: true, build: cpBuildDeviceFamilyImportRows, okLabel: "Import" };
  }
  if (/Device Management Tag Sets Add Tag/i.test(title) || (cell.querySelector('input[name="tagName"]') && cell.querySelector('input[name="tagValue"]'))) {
    return { label: "Tag", icon: CP_PROF_TAG_SVG, build: cpBuildTagAddRows, okLabel: "Create" };
  }
  if (/Device Management Tag Sets Modify Tag/i.test(title) || cell.querySelector('input[name="newTagValue"]')) {
    return { label: "Tag", icon: CP_PROF_TAG_SVG, build: cpBuildTagModifyRows, okLabel: "Save", deleteEntity: "tag" };
  }
  if (/Device Management Regions Add/i.test(title) || cell.querySelector('input[name="regionName"]')) {
    return { label: "Region", icon: CP_PROF_REGION_SVG, build: cpBuildRegionAddRows, okLabel: "Create" };
  }
  // End-anchored: must NOT also match "…Add Tag" (handled above).
  if (/Device Management Tag Sets Add$/i.test(title) || cell.querySelector('input[name="tagSetName"]')) {
    return { label: "New tag set", icon: CP_PROF_TAG_SVG, build: cpBuildTagSetAddRows, okLabel: "Create" };
  }
  // Identity/Device Profile Type Add — big device-type form (deviceType name + the deviceConfigOption master).
  // Builder is Add-scoped; the shape pair only exists on the Add page (Modify shows the name read-only).
  if (/Identity\/Device Profile Type Add/i.test(title) || (cell.querySelector('input[name="deviceType"]') && cell.querySelector('input[name="deviceConfigOption"]'))) {
    return { multiCard: true, build: cpBuildDeviceTypeAddRows, okLabel: "Add" };
  }
  return null;
}

/* Settings/edit FORM-page skinner (generic dispatcher — see
 * [[project-settings-form-skin]]). Shape-detected + idempotent; runs in
 * cpSkinDomPass + cp:reskin. The header + padding + action bar + mount below
 * are SHARED across every form page and are the LOCKED spec (glyph/bar + title,
 * NO subtitle; 22px cell inset; forward-click real ok/apply/cancel) — do not
 * special-case them per page. (Name kept as cpProfileForm for the call sites.) */
function cpProfileForm() {
  try {
    if (document.querySelector(".cp-console")) return;                    // aggregated console
    if (document.querySelector(".cp-results-box, #searchTable")) return;  // a list/search page
    var cell = document.querySelector("td.enduserbody");
    if (!cell) return;
    if (cell.querySelector(".cp-prof-card")) return;                      // already skinned
    var snEl = document.querySelector("td.screenName");
    var headTitle = snEl ? (snEl.textContent || "").trim() : "";
    var cfg = cpSettingsFormConfig(headTitle, cell);
    if (!cfg) return;                                                     // not a configured settings form

    // --- action bar (SHARED) — forwards to the real legacy ok/apply/cancel (last = bottom bar) ---
    function lastBtn(name) { var l = document.querySelectorAll('input[name="' + name + '"]'); return l.length ? l[l.length - 1] : null; }
    var realOk = lastBtn("ok"), realApply = lastBtn("apply"), realCancel = lastBtn("cancel");
    var actions = document.createElement("div"); actions.className = "cp-prof-actions";
    var unsaved = document.createElement("span"); unsaved.className = "cp-prof-unsaved";
    unsaved.innerHTML = '<span class="cp-prof-dot"></span><span>Unsaved changes</span>';
    actions.appendChild(unsaved);
    var spacer = document.createElement("span"); spacer.className = "cp-prof-actspace"; actions.appendChild(spacer);

    // --- dirty state (SHARED) — controls supplied by the row builder ---
    var controls = [];
    function ctrlState(el) { return (el.type === "checkbox" || el.type === "radio") ? (el.checked ? "1" : "0") : el.value; }
    function refresh() { actions.classList.toggle("cp-prof-dirty", controls.some(function (el) { return ctrlState(el) !== el.getAttribute("data-cp-orig"); })); }

    // --- content (page-specific): a SINGLE card (Profile/DAP) or MULTIPLE cards (STIR) ---
    var cards, sync, card = null, cardSubject = "";
    if (cfg.multiCard) {
      var resM = cfg.build(cell);
      if (!resM || !resM.cards || !resM.cards.length) return;            // builder bailed — no partial skin
      cards = resM.cards; controls = resM.controls || []; sync = resM.sync;
      actions.className = "cp-prof-actions cp-prof-actions-global";       // standalone bar after the cards
    } else {
      card = document.createElement("div"); card.className = "cp-prof-card";
      var head = document.createElement("div"); head.className = "cp-prof-cardhead";
      head.innerHTML = cfg.icon + "<span>" + cfg.label + "</span>";
      card.appendChild(head);
      var rowsWrap = document.createElement("div"); rowsWrap.className = "cp-prof-rows";
      card.appendChild(rowsWrap);
      var resS = cfg.build(rowsWrap, cell);
      if (!resS) return;
      controls = resS.controls || []; sync = resS.sync; cardSubject = resS.subject || "";
      cards = [card];
    }

    controls.forEach(function (el) { el.setAttribute("data-cp-orig", ctrlState(el)); el.addEventListener("input", refresh); el.addEventListener("change", refresh); });

    function addBtn(real, label, cls, svg, needDirty) {
      if (!real) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "cp-prof-btn " + cls + (needDirty ? " cp-prof-needdirty" : "");
      b.innerHTML = (svg || "") + "<span>" + label + "</span>";
      b.addEventListener("click", function () { real.click(); });
      actions.appendChild(b);
    }
    addBtn(realOk, cfg.okLabel || "Save", "cp-prof-primary", CP_PROF_CHECK_SVG, true);
    addBtn(realApply, "Apply", "cp-prof-secondary", "", true);
    addBtn(realCancel, "Cancel", "cp-prof-ghost", "", false);
    // Destructive Delete (e.g. admin Modify) → a danger button on the LEFT, gated behind a confirm modal that
    // forwards the real legacy `delete` click ONLY on confirm (the "double ask"). Generic: any form exposing a
    // `delete` button gets it.
    var realDelete = lastBtn("delete");
    if (realDelete) {
      var delBtn = document.createElement("button");
      delBtn.type = "button"; delBtn.className = "cp-prof-btn cp-prof-danger";
      delBtn.innerHTML = CP_PROF_TRASH_SVG + "<span>Delete</span>";
      var entity = cfg.deleteEntity || (headTitle.replace(/\s*(Modify|Add)\s*$/i, "").trim() || "item").toLowerCase();
      delBtn.addEventListener("click", function () { cpProfConfirmDelete(entity, cardSubject, realDelete, cfg.deleteMsg); });
      actions.insertBefore(delBtn, actions.firstChild);
    }
    if (!cfg.multiCard && card) card.appendChild(actions);               // single-card: footer inside the card

    // --- page header (LOCKED spec — matches .cp-srch-head: glyph/bar + title, NO subtitle) ---
    var pg = document.createElement("div"); pg.className = "cp-prof-head";
    var lead = document.createElement("span");
    var headIcon = cpMenuItemIcon(headTitle);
    if (headIcon) { lead.className = "cp-prof-headglyph"; lead.innerHTML = headIcon; }
    else { lead.className = "cp-prof-headbar"; }
    var txt = document.createElement("div"); txt.className = "cp-prof-headtxt";
    var ti = document.createElement("div"); ti.className = "cp-prof-title"; ti.textContent = headTitle;
    txt.appendChild(ti);
    pg.appendChild(lead); pg.appendChild(txt);

    // --- mount (SHARED) — content goes in a .cp-prof-scroll container so tall forms
    // (e.g. STIR-SHAKEN) scroll WITHIN the panel; it owns the LOCKED 22px inset too. ---
    Array.prototype.forEach.call(cell.children, function (ch) { ch.style.display = "none"; });
    var scroller = document.createElement("div"); scroller.className = "cp-prof-scroll";
    scroller.appendChild(pg);
    cards.forEach(function (c) { scroller.appendChild(c); });
    if (cfg.multiCard) scroller.appendChild(actions);                    // global action bar after the cards
    cell.appendChild(scroller);
    // Hide every legacy row ABOVE the enduserbody row — screenName, tip, spacers,
    // and the top OK button bar (whose bottom border was the stray divider).
    var ebTr = cell.closest("tr");
    if (ebTr) { for (var sib = ebTr.previousElementSibling; sib; sib = sib.previousElementSibling) sib.style.display = "none"; }
    // Hide the legacy bottom button-bar row(s).
    var bb = document.getElementById("buttonbarbottom"); if (bb) bb.style.display = "none";
    [realOk, realApply, realCancel].forEach(function (b) {
      if (!b) return; var tr = b.closest("tr"); if (tr) tr.style.display = "none"; else b.style.display = "none";
    });

    // Initial mirror — reflect real control state into the page's visuals.
    if (sync) sync();
  } catch (e) {
    console.warn("[CommPilot Skin] cpProfileForm:", e);
  }
}

/*
 * BroadWorks "temporarily unavailable" ERROR page → give OK a real escape (no loop).
 * On a transient token desync the server returns this page; its OK button calls redirectPost (a POST) which
 * re-fails on the now-dead token → the page just reloads into the same error. Our DNR redirect compounds it:
 * every /commpilot/ GET reload becomes a recovery that REPLAYS the failing nav → error again, trapping the
 * user (their intuition: "the redirect is messing things up"). Fix: clear the stored failing-nav recovery
 * state, and point OK at a CLEAN GET to /Login/ — DNR-ALLOWED (no redirect), so it re-establishes the session
 * and bounces to home when the session cookie is still valid. Validated live (the dead-token state escaped via
 * this exact path). Fires ONLY on the exact error text, so normal pages are untouched.
 */
function cpHandleErrorPage() {
  try {
    var body = document.body;
    if (!body) return false;
    var txt = body.textContent || "";
    if (!/temporarily unavailable/i.test(txt) || !/page you have selected/i.test(txt)) return false;
    // AUTO-RETRY the recovery ONCE before giving up. A recovery replay can transiently fail — most reliably right
    // after an EXTENSION reload: the orphaned old content scripts + re-injection churn poison the FIRST replay's
    // single-use token → the server 500s → this "temporarily unavailable" page. A clean second attempt almost always
    // succeeds (a plain reload recovers fine), so re-enter recovery instead of stranding the user at Login. Bounded
    // by cp-err-retries (reset on the next real app page by cpRevealCloak); cp-stub-tries is zeroed so the
    // interstitial loop-guard doesn't pre-empt the retry. KEEP the stored recover-nav so the retry replays the page.
    var rAt = 0; try { rAt = parseInt(sessionStorage.getItem("cp-replay-at") || "0", 10) || 0; } catch (e) {}
    var errTries = 0; try { errTries = parseInt(sessionStorage.getItem("cp-err-retries") || "0", 10) || 0; } catch (e) {}
    if (rAt && (Date.now() - rAt < 12000) && errTries < 1) {
      try { sessionStorage.setItem("cp-err-retries", String(errTries + 1)); } catch (e) {}
      try { sessionStorage.setItem("cp-stub-tries", "0"); } catch (e) {}
      try { sessionStorage.removeItem("cp-replay-at"); } catch (e) {}
      try { location.reload(); } catch (e) { try { location.assign("/commpilot/"); } catch (e2) {} }
      return true;
    }
    // Retry exhausted → original escape. Stop the recovery loop: the stored last-nav / recover-nav here IS the failing page.
    try { sessionStorage.removeItem("cp-last-nav"); } catch (e) {}
    try { if (window.chrome && chrome.storage && chrome.storage.local) chrome.storage.local.remove(["cpRecoverNav"]); } catch (e) {}
    // Rewire OK → clean GET to /Login/. cloneNode strips the page's native redirectPost click handler (it's
    // addEventListener-wired on this build), so only our escape listener remains.
    var btns = document.querySelectorAll('input.bwbutton, input[type="button"], input[type="submit"], button'), ok = null;
    for (var i = 0; i < btns.length; i++) {
      if (/^ok$/i.test((btns[i].value || btns[i].textContent || "").trim())) { ok = btns[i]; break; }
    }
    if (ok && ok.parentNode) {
      var clone = ok.cloneNode(true);
      ok.parentNode.replaceChild(clone, ok);
      clone.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        try { location.assign("/commpilot/Login/"); } catch (er) { location.href = "/commpilot/Login/"; }
      });
    }
    return true;
  } catch (e) { try { console.warn("[CommPilot Skin] cpHandleErrorPage:", e); } catch (e2) {} return false; }
}

/*
 * Full-skin DOM pass — re-applies every DOM transformation to the current
 * document body. Called on initial page load and on "cp:morphed" when
 * stubguard swaps in a fresh body (zero-navigation login morph).
 * The relative call order matches the original top-level execution order.
 */
function cpSkinDomPass() {
  if (cpLogoutToLogin()) return; // /Logout/ → straight to the styled login (no card)
  cpHandleErrorPage();           // BroadWorks "temporarily unavailable" → OK escapes to /Login/ (no loop)
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
  cpProfileForm();
  restyleAlerts();
  cpRevealCloak();
  if (cpWireHelpBodyFn) cpWireHelpBodyFn();
  cpSaveRecoverToken(false);
}

/* Re-skin on body morph (zero-navigation login — future phase). */
document.addEventListener("cp:morphed", function () { cpSkinDomPass(); });
document.addEventListener("cp:loginsplash", function () { cpLoginSplash(); });

/* FALLBACK: the redesigned search grid (pjax MAIN) failed to preload and restored the legacy list markup
 * (html.cp-grid-on already removed). Skin that legacy list in place so the user is never stranded. A dedicated
 * event — NOT cp:reskin — so pjax's cpAutoConsole doesn't re-enter the grid builder (no fallback loop). */
document.addEventListener("cp:skinlegacy", function () {
  [wrapSearchBox, wrapResultsBox, moveButtonBar, wrapResultsScroll, trimEditColumn, makeRowsClickable,
   wirePaginationIcons, formatPageIndicator, wireSortIcons, enhanceSelects, suppressEmptyResults, revealResultsBox]
    .forEach(function (fn) { try { fn(); } catch (e) { console.warn("[CommPilot Skin] skinlegacy", e); } });
});

/* Initial skin pass on this document. */
cpSkinDomPass();
