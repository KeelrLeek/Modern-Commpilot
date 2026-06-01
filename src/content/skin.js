console.log("[Modern CommPilot Skin] content script loaded");

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
  const url = (p) => chrome.runtime.getURL(p);

  // Map each left-nav row (1 = "OPTIONS:" label, 2..7 = items) to its icon.
  const navIcons = {
    2: "assets/icons/profile.svg",
    3: "assets/icons/resources.svg",
    4: "assets/icons/services.svg",
    5: "assets/icons/callcenter.svg",
    6: "assets/icons/meetme.svg",
    7: "assets/icons/utilities.svg",
  };

  let css = `
@font-face {
  font-family: "Inter";
  src: url("${url("assets/fonts/InterVariable.woff2")}") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist";
  src: url("${url("assets/fonts/GeistVariable.woff2")}") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
`;

  for (const [row, path] of Object.entries(navIcons)) {
    css += `
form[name="leftNavForm"] table tr:nth-child(${row}) a::before {
  background-image: url("${url(path)}") !important;
}`;
  }

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
(function wrapMenuCards() {
  const anchors = document.querySelectorAll(
    'td[width="50%"] a.navMenuItem'
  );

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
})();
