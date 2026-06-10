console.log("[Modern CommPilot Skin] content script loaded");

function cpSaveRecoverToken(resetTries) {
  try {
    if (location.pathname.indexOf("/Login/") !== -1 || document.querySelector('input[type=password]')) return;
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

  let css = "";

  for (const [row, path] of Object.entries(navIcons)) {
    css += `
form[name="leftNavForm"] table tr:nth-child(${row}) a::before {
  background-image: url("${url(path)}") !important;
}`;
  }

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
  background-image: url("${url(path)}") !important;
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
}

wrapMenuCards();

function tagMenuColumns() {
  document.querySelectorAll("td.menuCategory").forEach(function (mc) {
    try {
      var t = mc.closest("table");
      var col = t && t.parentElement;
      if (col && col.tagName === "TD") col.classList.add("cp-menu-col");
    } catch (e) {}
  });
}

tagMenuColumns();

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
    staggerCards();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin staggerCards", e);
  }
  try {
    revealResultsBox();
  } catch (e) {
    console.warn("[CommPilot Skin] reskin revealResultsBox", e);
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
(function moveHeaderLinks() {
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
})();

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
(function wireHomeButton() {
  try {
    if (window.__cpHomeWired) return;
    window.__cpHomeWired = true;

    const homeBtn = document.querySelector(
      '.cp-footer-btn[data-cp-icon="home"]'
    );
    const resellerLink = document.querySelector(
      'a.headerAuthLevelLink'
    );

    /* Both must exist; if the Reseller link is absent (e.g. a page
       without it), leave Home unchanged. */
    if (!homeBtn || !resellerLink) return;

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
})();

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
wireSortIcons();

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
wirePaginationIcons();

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
formatPageIndicator();

/*
 * Replace the native <select> popups in the search criteria with a branded,
 * animated custom dropdown.  The native <select> is kept in the form (hidden
 * via inline display:none) and synced on every choice (value set + change
 * dispatched) so the site's getChoice handler and the search submit still
 * work.  Idempotent (per-select flag); re-runs on reskin and on "+" rows.
 */
function enhanceSelects() {
  try {
    document.querySelectorAll("#searchTable select").forEach(function (sel) {
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
    });
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
enhanceSelects();

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
    // Menu cards: stagger within each column so both columns fill top-down
    document.querySelectorAll("td.cp-menu-col").forEach(function (col) {
      col.querySelectorAll(".cp-menu-card").forEach(function (card, i) { run(card, i * CARD_STEP, CARD_DUR); });
    });
    // Result rows: stagger down the whole list at the row cadence
    document.querySelectorAll(".cp-results-box tr.unselected").forEach(function (row, i) {
      run(row, i * ROW_STEP, ROW_DUR);
    });
  } catch (e) { console.warn("[CommPilot Skin] staggerCards:", e); }
}
staggerCards();

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

wrapResultsBox();

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

wrapSearchBox();

/*
 * Login page — build a centered glass card from the legacy form fields.
 * Idempotent: checks for .cp-login-card before rebuilding.
 */
function buildLoginCard() {
  try {
    var form = document.querySelector('form[name="loginForm"]');
    if (!form || !form.querySelector('input[name="Password"]')) return; // not login page
    if (form.querySelector(".cp-login-card")) return; // idempotent

    document.body.classList.add("cp-login-page");

    var card = document.createElement("div");
    card.className = "cp-login-card";

    var brand = document.createElement("div");
    brand.className = "cp-login-brand";
    brand.textContent = "CommPilot";
    var sub = document.createElement("div");
    sub.className = "cp-login-sub";
    sub.textContent = "Sign in to your portal";
    var logo = document.createElement("img");
    logo.className = "cp-login-logo";
    logo.src = chrome.runtime.getURL("assets/icons/trifecta-mark.svg");
    logo.alt = "";
    card.appendChild(logo);
    card.appendChild(brand);
    card.appendChild(sub);

    // Session/auth notice -> styled alert (only when present)
    var notice = Array.prototype.slice.call(document.querySelectorAll("td,span,div,p,b,font"))
      .find(function (e) {
        return e.childElementCount === 0 &&
          /not authorized|login again|session timeout/i.test(e.textContent || "");
      });
    if (notice) {
      var al = document.createElement("div");
      al.className = "cp-login-alert";
      al.textContent = notice.textContent.trim();
      card.appendChild(al);
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
      card.appendChild(field);
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
      card.appendChild(row);
    }

    // Login button — reuse the existing <a> (preserves its submit handler)
    var btn = Array.prototype.slice.call(form.querySelectorAll("a"))
      .find(function (a) { return a.textContent.trim() === "Login"; });
    if (btn) {
      btn.classList.add("cp-login-btn");
      btn.textContent = "Sign In";
      card.appendChild(btn);
    }

    // Hide legacy presentation inside the form (keep our card + hidden inputs)
    Array.prototype.slice.call(form.children).forEach(function (child) {
      if (child === card) return;
      if (child.tagName === "INPUT" && child.type === "hidden") return;
      child.style.display = "none";
    });

    form.appendChild(card);
  } catch (e) {
    console.warn("[CommPilot Skin] buildLoginCard:", e);
  }
}

buildLoginCard();

/*
 * Move the breadcrumb trail (a.headerAuthLevelLink chain) out of the
 * header bar and place it just above the page title as a thin bar.
 */
(function moveBreadcrumb() {
  try {
    if (document.documentElement.dataset.cpBreadcrumbMoved) return;
    document.documentElement.dataset.cpBreadcrumbMoved = "1";

    var src = document.querySelector("td.headerBar a.headerAuthLevelLink");
    if (!src) return;
    var cell = src.closest("td");
    if (!cell) return;

    var title = document.querySelector("td.screenName");
    if (!title) return;
    var titleTable = title.closest("table");
    if (!titleTable) return;

    var bar = document.createElement("div");
    bar.className = "cp-breadcrumb";

    /* Move every child node EXCEPT img and script elements */
    var nodes = Array.from(cell.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 1 && (n.tagName === "IMG" || n.tagName === "SCRIPT")) continue;
      bar.appendChild(n);
    }

    titleTable.parentNode.insertBefore(bar, titleTable);
    cell.style.display = "none";
  } catch (e) {
    console.warn("[CommPilot Skin] moveBreadcrumb:", e);
  }
})();

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

moveButtonBar();
wrapResultsScroll();
trimEditColumn();
makeRowsClickable();
revealResultsBox();

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
    var x = cx + 15;
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
    var btn = document.querySelector(
      '.cp-footer-btn[data-cp-icon="help"]'
    );
    if (!btn) return false;
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
})();
