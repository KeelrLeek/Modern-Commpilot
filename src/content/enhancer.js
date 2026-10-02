(() => {
  "use strict";

  // The original BroadWorks userscript handled these links. Keep that behavior
  // while adding search without replacing the page's own form controls.
  const MENU_SELECTOR = [
    ".dropdown-menu",
    "[role='listbox']",
    "[role='menu'][aria-labelledby]",
    ".x-combo-list-inner",
    ".dijitSelectMenu",
    ".dijitComboBoxMenu"
  ].join(",");
  const MENU_ITEM_SELECTOR = [
    "[role='option']",
    "[role='menuitem']",
    ".dropdown-item",
    ".x-combo-list-item"
  ].join(",");
  const selectInfo = new Map();
  const menuInfo = new Map();
  const pendingRoots = new Set();
  const pendingMenus = new Set();
  let pendingOptionRefresh = false;
  let pendingCleanup = false;
  let scanScheduled = false;
  let popover;
  let searchInput;
  let summary;
  let createBox;
  let resultsBox;
  let openSelect = null;
  let shownOptions = [];
  let activeResult = -1;
  let activeRow = null;
  const RESULT_HEIGHT = 32;
  const RESULT_OVERSCAN = 6;
  let renderedStart = -1;
  let renderedEnd = -1;
  const COPY_CACHE_PREFIX = "bw-extension:";

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function isUsersSearchPage() {
    return /^\/commpilot\/group\/members(?:\/|$)/i.test(location.pathname);
  }

  function userBreadcrumb() {
    for (const header of document.querySelectorAll("td.headerBar")) {
      const links = Array.from(header.querySelectorAll("a.headerAuthLevelLink"));
      const users = links.find(link => normalize(link.textContent) === "users");
      const current = header.querySelector("span.headerAuthLevel");
      if (!users || !current ||
          !(users.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const userId = current.textContent.trim();
      if (!userId) continue;
      const trail = links.slice(0, links.indexOf(users) + 1)
        .map(link => link.textContent.trim());
      return {
        header,
        userId,
        cacheKey: COPY_CACHE_PREFIX + JSON.stringify([location.origin, ...trail, userId])
      };
    }
    return null;
  }

  function displayedExtension(context) {
    const input = document.querySelector('input#extension[name="extension"]');
    return input && input.dataset.bwCopyIdentity === context.cacheKey
      ? input.value.trim() : null;
  }

  // null: not known yet. "" is known: the user has no extension.
  function cachedExtension(context) {
    try {
      return sessionStorage.getItem(context.cacheKey);
    } catch (_) {
      return null;
    }
  }

  function rememberExtension(context, value) {
    try {
      sessionStorage.setItem(context.cacheKey, value || "");
    } catch (_) {
      // The current Addresses field can still be copied if storage is blocked.
    }
  }

  function extensionFor(context) {
    const visible = displayedExtension(context);
    return visible === null ? cachedExtension(context) || "" : visible;
  }

  // A Users list shows each user's extension: note it for the row being opened, so the user's pages know it
  // without pjax.js reading their Addresses page (which takes BroadWorks seconds in a group with many numbers
  // and devices). The header and the rows share column positions.
  const LISTED_KEY = "bw-extension-listed";
  function cellText(cell) {
    const copy = cell.cloneNode(true);
    copy.querySelectorAll("script, style").forEach(node => node.remove());
    return copy.textContent.replace(/\s+/g, " ").trim();
  }
  function noteListedExtension(event) {
    const row = event.target instanceof Element ? event.target.closest('tr[id^="Row"]') : null;
    const head = row?.parentElement?.querySelector(":scope > tr:has(> td.listHeader)");
    if (!head) return;
    const names = Array.from(head.children, cell => normalize(cellText(cell)));
    const idAt = names.indexOf("user id"), extAt = names.indexOf("extension");
    if (idAt < 0 || extAt < 0 || row.children.length !== names.length) return;
    const userId = cellText(row.children[idAt]);
    if (!userId) return;
    try {
      sessionStorage.setItem(LISTED_KEY, JSON.stringify({
        origin: location.origin, userId, extension: cellText(row.children[extAt]), at: Date.now()
      }));
    } catch (_) {}
  }
  function adoptListedExtension(context) {
    if (cachedExtension(context) !== null) return;
    try {
      const listed = JSON.parse(sessionStorage.getItem(LISTED_KEY) || "null");
      if (listed && listed.origin === location.origin && normalize(listed.userId) === normalize(context.userId) &&
          Date.now() - listed.at < 10 * 60 * 1000) rememberExtension(context, listed.extension);
    } catch (_) {}
  }

  function fallbackCopy(value) {
    const textarea = document.createElement("textarea");
    const focused = document.activeElement;
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (focused instanceof HTMLElement) focused.focus();
    return copied;
  }

  function reportCopy(toolbar, message) {
    const status = toolbar.querySelector(".bw-copy-status");
    status.textContent = message;
    clearTimeout(toolbar.bwStatusTimer);
    toolbar.bwStatusTimer = setTimeout(() => {
      if (status.isConnected) status.textContent = "";
    }, 2500);
  }

  function writeClipboard(value, done) {
    const tryFallback = () => {
      try { done(fallbackCopy(value)); } catch (_) { done(false); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(() => done(true), tryFallback);
    } else {
      tryFallback();
    }
  }

  // CommPilot 2.0 (a palette is active): Copy User ID is an icon on the breadcrumb's user-id pill, and the
  // extension shows in a chip joined to it (crumbs.js keeps the chip beside the pill). pjax.js reads the
  // extension from the user's Addresses page when the user's board opens and marks the id element
  // (data-cp-extension-state / data-cp-extension); a value already cached for this user is used as is.
  // CommPilot without the theme keeps the toolbar below.
  const themed = () => Boolean(document.documentElement.dataset.cpDirection) &&
    document.body?.id === "initBody.menuTemplate";
  const svgIcon = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const COPY_ICON = svgIcon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
  const CHECK_ICON = svgIcon('<path d="M20 6 9 17l-5-5"/>');
  let tip = null, tipFor = null, tipTimer = 0;

  function showTip(target, text, sticky) {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "cp-tip";
      tip.setAttribute("role", "status");
      tip.setAttribute("aria-live", "polite");
      document.body.append(tip);
    }
    clearTimeout(tipTimer);
    tipFor = target;
    tip.textContent = text;
    tip.hidden = false;
    const box = target.getBoundingClientRect(), own = tip.getBoundingClientRect();
    tip.style.top = `${Math.round(box.bottom + 9)}px`;
    tip.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - own.width - 8, box.left + box.width / 2 - own.width / 2)))}px`;
    if (sticky) tipTimer = setTimeout(hideTip, 1600);
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function tipOn(el) {
    el.addEventListener("mouseenter", () => showTip(el, el.dataset.cpTip));
    el.addEventListener("focus", () => showTip(el, el.dataset.cpTip));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("blur", hideTip);
  }

  function copyFromPill(kind, button) {
    const context = userBreadcrumb();
    if (!context) return;
    const value = kind === "user-id" ? context.userId.split("@", 1)[0].trim() : extensionFor(context);
    if (!value) return;
    writeClipboard(value, ok => {
      showTip(button, ok ? `Copied ${value}` : "Could not copy", true);
      if (!ok) return;
      button.classList.add("cp-copied");
      const icon = button.querySelector("svg");
      if (icon) icon.outerHTML = CHECK_ICON;
      setTimeout(() => {
        button.classList.remove("cp-copied");
        const done = button.querySelector("svg");
        if (done) done.outerHTML = COPY_ICON;
      }, 1600);
    });
  }

  function syncPillControls(context) {
    const span = context.header.querySelector("span.headerAuthLevel");
    if (!span) return;
    context.header.querySelector(".bw-copy-controls[data-bw-owned='1']")?.remove();
    if (tipFor && !tipFor.isConnected) hideTip();   // pjax rewrote the header under the pointer
    const read = span.getAttribute("data-cp-extension-state");
    const cached = cachedExtension(context);
    if (read === "done" && span.hasAttribute("data-cp-extension")) {
      rememberExtension(context, span.getAttribute("data-cp-extension"));
    } else if (!read && cached !== null) {   // already known for this user: nothing for pjax.js to read
      span.setAttribute("data-cp-extension", cached);
      span.setAttribute("data-cp-extension-state", "done");
    }
    let idButton = span.querySelector("button.cp-copy-id");
    if (!idButton) {
      idButton = document.createElement("button");
      idButton.type = "button";
      idButton.className = "cp-copy-id";
      idButton.setAttribute("aria-label", "Copy user ID");
      idButton.dataset.cpTip = "Copy user ID";
      idButton.innerHTML = COPY_ICON;
      idButton.addEventListener("click", event => { event.stopPropagation(); copyFromPill("user-id", idButton); });
      tipOn(idButton);
      span.append(idButton);   // an icon only: the id's text (read by the tools and pjax.js) is unchanged
    }
    let chip = context.header.querySelector("button.cp-ext-chip");
    if (!chip) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cp-ext-chip cp-bc-attach";
      chip.addEventListener("click", () => copyFromPill("extension", chip));
      tipOn(chip);
      span.after(chip);
    }
    const ext = extensionFor(context);
    const state = ext ? "value" : span.getAttribute("data-cp-extension-state") || "unknown";
    if (chip.dataset.state === state + ext) return;
    chip.dataset.state = state + ext;
    const value = document.createElement("b");
    value.textContent = ext || (state === "loading" ? "…" : "–");
    chip.replaceChildren("EXT ", value);
    chip.insertAdjacentHTML("beforeend", state === "loading" ? '<span class="cp-ext-spin" aria-hidden="true"></span>' : ext ? COPY_ICON : "");
    chip.setAttribute("aria-disabled", String(!ext));   // not disabled: its tooltip still explains why
    chip.dataset.cpTip = ext ? `Copy extension ${ext}` : state === "loading" ? "Loading extension…" :
      state === "done" ? "This user has no extension" : "Open Profile > Addresses to load the extension";
    chip.setAttribute("aria-label", chip.dataset.cpTip);
  }

  function copyBreadcrumbValue(header, kind) {
    const context = userBreadcrumb();
    if (!context || context.header !== header) return;
    const value = kind === "user-id"
      ? context.userId.split("@", 1)[0].trim()
      : extensionFor(context);
    const toolbar = header.querySelector(".bw-copy-controls[data-bw-owned='1']");
    if (!value) {
      reportCopy(toolbar, "Open Profile > Addresses to load extension");
      return;
    }
    const success = () => reportCopy(toolbar, "Copied");
    const failure = () => reportCopy(toolbar, "Could not copy");
    const tryFallback = () => {
      try { fallbackCopy(value) ? success() : failure(); }
      catch (_) { failure(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(success, tryFallback);
    } else {
      tryFallback();
    }
  }

  // The copy controls live in the page the user sees, never in the frames pjax.js loads pages in (it copies a
  // frame's header into the page). With the theme on, the old toolbar has no place anywhere: a copy carried in by a
  // page swap goes. On CommPilot's own shell the theme is always coming (theme-settings.js), so the toolbar is only
  // built if it still has not arrived a moment later.
  let themeWait = 0;
  function syncCopyControls() {
    if (window !== window.top) return;
    if (themed()) document.querySelectorAll(".bw-copy-controls[data-bw-owned='1']").forEach(el => el.remove());
    else if (document.body?.id === "initBody.menuTemplate" && themeWait !== -1) {
      if (!themeWait) themeWait = setTimeout(() => { themeWait = -1; syncCopyControls(); }, 1500);
      return;
    }
    const context = userBreadcrumb();
    if (!context) return;
    adoptListedExtension(context);
    if (themed()) {
      watchExtensionField(context);
      syncPillControls(context);
      return;
    }
    context.header.querySelectorAll(".cp-copy-id, .cp-ext-chip").forEach(el => el.remove());
    let toolbar = context.header.querySelector(".bw-copy-controls[data-bw-owned='1']");
    if (!toolbar) {
      toolbar = document.createElement("span");
      toolbar.className = "bw-copy-controls";
      toolbar.dataset.bwOwned = "1";
      for (const [kind, label] of [["user-id", "Copy User ID"], ["extension", "Copy Extension"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.bwCopy = kind;
        button.textContent = label;
        button.addEventListener("click", () => copyBreadcrumbValue(context.header, kind));
        toolbar.append(button);
      }
      const status = document.createElement("span");
      status.className = "bw-copy-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      toolbar.append(status);
      context.header.append(toolbar);
    }
    toolbar.dataset.bwTheme = isDarkBackground(context.header) ? "dark" : "light";
    watchExtensionField(context);
    const button = toolbar.querySelector('[data-bw-copy="extension"]');
    const available = !!extensionFor(context);
    button.disabled = !available;
    button.title = available ? "Copy this user's extension" :
      "Open Profile > Addresses to load this user's extension";
  }

  function watchExtensionField(context) {
    const field = document.querySelector('input#extension[name="extension"]');
    if (field && field.dataset.bwCopyWatched !== "1") {
      field.dataset.bwCopyWatched = "1";
      field.dataset.bwCopyIdentity = context.cacheKey;
      rememberExtension(context, field.value.trim());
      const refresh = () => {
        const current = userBreadcrumb();
        if (current && current.cacheKey === field.dataset.bwCopyIdentity) {
          rememberExtension(current, field.value.trim());
        }
        syncCopyControls();
      };
      field.addEventListener("input", refresh);
      field.addEventListener("change", refresh);
    }
  }

  function colorize(anchor) {
    if (anchor.dataset.bwColoredLabel === anchor.textContent &&
        anchor.querySelector(".bw-on-off-status[data-bw-owned='1']")) return;
    anchor.querySelectorAll(".bw-on-off-status[data-bw-owned='1']").forEach(span => {
      span.replaceWith(...Array.from(span.childNodes));
    });

    const label = anchor.textContent || "";
    const match = label.match(/^([\s\S]*?)(\s*-\s*)(On|Off)\s*$/i);
    if (!match) {
      delete anchor.dataset.bwColoredLabel;
      return;
    }

    const start = match[1].length;
    const end = start + match[2].length + match[3].length;
    const nodes = [];
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const next = offset + node.textContent.length;
      nodes.push({ node, start: offset, end: next });
      offset = next;
    }
    for (const entry of nodes) {
      const from = Math.max(start, entry.start) - entry.start;
      const to = Math.min(end, entry.end) - entry.start;
      if (to <= from) continue;
      const part = from ? entry.node.splitText(from) : entry.node;
      const length = to - from;
      if (part.textContent.length > length) part.splitText(length);
      const status = document.createElement("span");
      status.className = "bw-on-off-status";
      status.dataset.bwOwned = "1";
      status.dataset.bwState = match[3].toLowerCase();
      part.replaceWith(status);
      status.append(part);
    }
    anchor.dataset.bwColoredLabel = anchor.textContent || "";
  }

  function selectLabel(select) {
    const label = select.getAttribute("aria-label") ||
      (select.labels && select.labels[0] && select.labels[0].textContent) ||
      select.getAttribute("name") || "dropdown";
    return label.trim().replace(/\s+/g, " ").slice(0, 100) || "dropdown";
  }

  function isDarkBackground(element) {
    for (let current = element; current instanceof Element; current = current.parentElement) {
      const color = getComputedStyle(current).backgroundColor;
      const parts = color.match(/^rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
      if (!parts || color.endsWith(", 0)")) continue;
      const luminance = Number(parts[1]) * 0.2126 +
        Number(parts[2]) * 0.7152 + Number(parts[3]) * 0.0722;
      return luminance < 128;
    }
    return false;
  }

  function syncSelect(select, info) {
    if (!select.isConnected) return;
    if (!info.shell.contains(select)) {
      select.before(info.shell);
      info.shell.prepend(select);
    }
    if (!info.shell.contains(info.trigger)) info.shell.append(info.trigger);
    const style = getComputedStyle(select);
    info.shell.hidden = select.hidden || style.display === "none" ||
      style.visibility === "hidden";
    if (!info.shell.hidden) {
      const bounds = select.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        const shellBounds = info.shell.getBoundingClientRect();
        if (info.needsMeasurement || Math.abs(shellBounds.width - bounds.width) > 1) {
          info.shell.style.width = bounds.width + "px";
        }
        if (info.needsMeasurement || Math.abs(shellBounds.height - bounds.height) > 1) {
          info.shell.style.height = bounds.height + "px";
        }
        info.needsMeasurement = false;
      }
    }
    const off = select.matches(":disabled");
    info.trigger.disabled = off;
    info.trigger.setAttribute("aria-disabled", String(off));
    info.trigger.tabIndex = off ? -1 : 0;
    info.trigger.setAttribute("aria-label", selectLabel(select) + ": " +
      (select.selectedOptions[0]?.textContent.trim() || "No selection") +
      ". Search options");
    info.trigger.setAttribute("aria-invalid", String(!select.validity.valid));
    if (openSelect === select && (info.shell.hidden || info.trigger.disabled)) closePopover(false);
  }

  function enhanceSelect(select) {
    if (select.closest(".bw-search-popover, .bw-menu-search") ||
        select.multiple || select.size > 1) return;
    let info = selectInfo.get(select);
    if (info) {
      syncSelect(select, info);
      return;
    }

    const style = getComputedStyle(select);
    const bounds = select.getBoundingClientRect();
    const shell = document.createElement("span");
    shell.className = "bw-select-shell";
    shell.style.display = style.display === "block" ? "block" : "inline-block";
    if (bounds.width > 0) shell.style.width = bounds.width + "px";
    if (bounds.height > 0) shell.style.height = bounds.height + "px";
    shell.style.verticalAlign = style.verticalAlign;
    select.before(shell);
    shell.append(select);

    // A focusable span, not a button: it never joins the form's elements, so scripts that count or index them (the
    // Users search) see CommPilot's form exactly as it was.
    const trigger = document.createElement("span");
    trigger.tabIndex = 0;
    trigger.className = "bw-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", "bw-search-popover");
    trigger.setAttribute("aria-expanded", "false");
    shell.append(trigger);

    const original = {
      tabIndex: select.getAttribute("tabindex"),
      ariaHidden: select.getAttribute("aria-hidden"),
      pointerEvents: select.style.pointerEvents,
      searchable: select.getAttribute("data-bw-searchable")
    };
    select.dataset.bwSearchable = "1";
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.style.pointerEvents = "none";

    const attributeObserver = new MutationObserver(() => syncSelect(select, info));
    info = {
      shell, trigger, attributeObserver, original, options: [],
      needsMeasurement: bounds.width === 0 || bounds.height === 0
    };
    selectInfo.set(select, info);
    const resizeObserver = new ResizeObserver(() => syncSelect(select, info));
    info.resizeObserver = resizeObserver;
    resizeObserver.observe(select);
    attributeObserver.observe(select, {
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "disabled", "aria-label", "name", "required"]
    });
    trigger.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (!trigger.disabled && !shell.hidden) openPopover(select);
    });
    trigger.addEventListener("keydown", event => {
      const opens = ["Enter", " ", "Spacebar", "ArrowDown", "ArrowUp", "F4"];
      if (opens.includes(event.key) || (event.altKey && event.key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        if (!trigger.disabled && !shell.hidden) openPopover(select);
      } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!trigger.disabled && !shell.hidden) {
          openPopover(select);
          searchInput.value = event.key;
          renderResults();
        }
      }
    });
    const onSelectClick = event => {
      if (!event.isTrusted || select.matches(":disabled")) return;
      event.preventDefault();
      openPopover(select);
    };
    const onSelectChange = () => {
      syncSelect(select, info);
      if (openSelect === select) renderResults();
    };
    info.onSelectClick = onSelectClick;
    info.onSelectChange = onSelectChange;
    select.addEventListener("click", onSelectClick);
    select.addEventListener("change", onSelectChange);
    syncSelect(select, info);
  }

  function ensurePopover() {
    if (popover) return;
    popover = document.createElement("div");
    popover.className = "bw-search-popover";
    popover.id = "bw-search-popover";
    popover.hidden = true;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Search dropdown options");

    searchInput = document.createElement("input");
    searchInput.className = "bw-search-input";
    searchInput.type = "search";
    searchInput.placeholder = "Type to search options";
    searchInput.setAttribute("aria-label", "Search dropdown options");
    searchInput.setAttribute("role", "combobox");
    searchInput.setAttribute("aria-autocomplete", "list");
    searchInput.setAttribute("aria-expanded", "true");

    summary = document.createElement("div");
    summary.className = "bw-search-summary";
    summary.setAttribute("aria-live", "polite");

    resultsBox = document.createElement("div");
    resultsBox.className = "bw-search-results";
    resultsBox.id = "bw-search-results";
    resultsBox.setAttribute("role", "listbox");
    searchInput.setAttribute("aria-controls", resultsBox.id);

    const field = document.createElement("span");
    field.className = "bw-search-field";
    field.append(searchInput);
    // The count, and on its right a button for an option that starts something new ("New Identity/Device
    // Profile (Group)"): it picks that option, so CommPilot does what it does when the option is chosen.
    const head = document.createElement("div");
    head.className = "bw-search-head";
    createBox = document.createElement("span");
    createBox.className = "bw-search-create";
    head.append(summary, createBox);
    popover.append(field, head, resultsBox);
    createBox.addEventListener("click", event => {
      const button = event.target.closest("[data-bw-option-index]");
      if (button) chooseOption(Number(button.dataset.bwOptionIndex));
    });
    document.body.append(popover);
    popover.addEventListener("click", event => event.stopPropagation());
    searchInput.addEventListener("input", event => {
      event.stopPropagation();
      renderResults();
    });
    searchInput.addEventListener("keydown", onSearchKeydown);
    searchInput.addEventListener("keypress", event => event.stopPropagation());
    searchInput.addEventListener("keyup", event => event.stopPropagation());
    resultsBox.addEventListener("click", event => {
      const row = event.target.closest("[data-bw-option-index]");
      if (row && resultsBox.contains(row)) chooseOption(Number(row.dataset.bwOptionIndex));
    });
    resultsBox.addEventListener("scroll", renderVisibleResults);
  }

  function collectOptions(select) {
    const info = selectInfo.get(select);
    if (!info) return;
    info.options = Array.from(select.options, (option, index) => {
      const group = option.parentElement && option.parentElement.tagName === "OPTGROUP"
        ? option.parentElement : null;
      const label = option.label || option.textContent || "";
      const groupLabel = group ? group.label : "";
      return {
        index,
        label: label.trim(),
        groupLabel,
        searchable: normalize(groupLabel + " " + label),
        disabled: option.disabled || Boolean(group && group.disabled)
      };
    });
  }

  function positionPopover() {
    if (!openSelect || !popover || popover.hidden) return;
    const info = selectInfo.get(openSelect);
    if (!info || !info.trigger.isConnected) {
      closePopover(false);
      return;
    }
    const rect = openSelect.getBoundingClientRect();
    // Room for a "+ New …" button beside the count when there is one.
    const least = createBox && !createBox.hidden ? 380 : 280;
    const width = Math.min(Math.max(420, least), Math.max(least, rect.width), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const useAbove = below < 220 && above > below;
    const available = Math.max(100, useAbove ? above : below);
    const height = Math.min(360, available);
    popover.style.width = width + "px";
    popover.style.maxHeight = height + "px";
    popover.style.left = left + "px";
    popover.style.top = (useAbove ? Math.max(8, rect.top - height - 4) : rect.bottom + 4) + "px";
    popover.dataset.bwSide = useAbove ? "above" : "below";
  }

  function openPopover(select) {
    if (openSelect === select) return;
    ensurePopover();
    if (openSelect) closePopover(false);
    openSelect = select;
    const info = selectInfo.get(select);
    info.trigger.setAttribute("aria-expanded", "true");
    popover.setAttribute("aria-label", "Search options for " + selectLabel(select));
    searchInput.setAttribute("aria-label", "Search options for " + selectLabel(select));
    popover.dataset.bwTheme = isDarkBackground(select) ? "dark" : "light";
    collectOptions(select);
    renderCreate(select);
    searchInput.value = "";
    popover.hidden = false;
    positionPopover();
    renderResults();
    // Open on the current value, in the middle of the list (a 172-department list opens at Houston, not at the top).
    if (activeResult > 0) {
      resultsBox.scrollTop = Math.max(0, activeResult * RESULT_HEIGHT - (resultsBox.clientHeight - RESULT_HEIGHT) / 2);
      renderVisibleResults();
      updateActiveResult(false);
    }
    searchInput.focus();
  }

  // CommPilot's own "start something new" option: "New Identity/Device Profile (Group)" carries a code value
  // ("New Device") that differs from its words. A device or a state that is merely NAMED "New …" ("New 1148 (Group)",
  // "New Jersey") has its name as its value, so it never qualifies.
  function isCreateOption(select, entry) {
    const option = select.options[entry.index];
    if (!option || entry.disabled || !/^new\b/i.test(entry.label)) return false;
    const value = String(option.value || "").trim();
    return /^new\b/i.test(value) && value.toLowerCase() !== entry.label.toLowerCase();
  }
  function renderCreate(select) {
    const info = selectInfo.get(select);
    createBox.replaceChildren();
    for (const entry of (info?.options || []).filter(o => isCreateOption(select, o)).slice(0, 1)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bw-search-create-btn";
      button.dataset.bwOptionIndex = String(entry.index);
      // "+ New Identity/Device Profile": the option's words without its scope in brackets; the full words as the tip.
      button.textContent = "+ " + entry.label.replace(/\s*\([^)]*\)\s*$/, "");
      button.title = entry.label;
      button.setAttribute("aria-label", entry.label);
      createBox.append(button);
    }
    createBox.hidden = !createBox.childElementCount;
  }

  function closePopover(restoreFocus) {
    if (!openSelect) return;
    const info = selectInfo.get(openSelect);
    openSelect = null;
    shownOptions = [];
    activeResult = -1;
    activeRow = null;
    renderedStart = renderedEnd = -1;
    if (popover) popover.hidden = true;
    if (info) {
      info.trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus && info.trigger.isConnected) info.trigger.focus();
    }
  }

  function renderResults() {
    if (!openSelect) return;
    const info = selectInfo.get(openSelect);
    if (!info) return;
    const query = normalize(searchInput.value);
    shownOptions = [];

    for (const entry of info.options) {
      if (!entry.searchable.includes(query)) continue;
      shownOptions.push(entry);
    }

    activeRow = null;
    renderedStart = renderedEnd = -1;
    resultsBox.scrollTop = 0;
    const matchCount = shownOptions.length;
    summary.textContent = matchCount === 0 ? "No matching options" :
      matchCount + (matchCount === 1 ? " matching option" : " matching options");
    activeResult = shownOptions.findIndex(entry => !entry.disabled &&
      entry.index === openSelect.selectedIndex);
    if (activeResult < 0) activeResult = shownOptions.findIndex(entry => !entry.disabled);
    renderVisibleResults();
  }

  function renderVisibleResults() {
    if (!openSelect || !resultsBox) return;
    const viewportRows = Math.ceil((resultsBox.clientHeight || 240) / RESULT_HEIGHT);
    const start = Math.max(0, Math.floor(resultsBox.scrollTop / RESULT_HEIGHT) - RESULT_OVERSCAN);
    const end = Math.min(shownOptions.length, start + viewportRows + RESULT_OVERSCAN * 2);
    if (start === renderedStart && end === renderedEnd) return;
    renderedStart = start;
    renderedEnd = end;
    const fragment = document.createDocumentFragment();
    const spacer = height => {
      const element = document.createElement("div");
      element.className = "bw-search-spacer";
      element.style.height = height + "px";
      element.setAttribute("aria-hidden", "true");
      return element;
    };
    if (start) fragment.append(spacer(start * RESULT_HEIGHT));
    const typed = searchInput.value.trim().toLowerCase();
    if (!shownOptions.length) {
      const empty = document.createElement("div");
      empty.className = "bw-search-empty";
      empty.textContent = typed ? "Nothing matches “" + searchInput.value.trim() + "”" : "No options";
      fragment.append(empty);
    }
    for (let position = start; position < end; position++) {
      const entry = shownOptions[position];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "bw-search-result";
      row.id = "bw-search-option-" + entry.index;
      row.dataset.bwOptionIndex = String(entry.index);
      row.dataset.bwResultPosition = String(position);
      row.setAttribute("role", "option");
      row.setAttribute("aria-posinset", String(position + 1));
      row.setAttribute("aria-setsize", String(shownOptions.length));
      row.setAttribute("aria-selected", String(entry.index === openSelect.selectedIndex));
      row.disabled = entry.disabled;
      if (entry.groupLabel) {
        const group = document.createElement("span");
        group.className = "bw-result-group";
        group.textContent = entry.groupLabel + " — ";
        row.append(group);
      }
      const text = document.createElement("span");
      text.className = "bw-result-text";
      const at = typed ? entry.label.toLowerCase().indexOf(typed) : -1;
      if (at >= 0) {
        const mark = document.createElement("mark");
        mark.className = "bw-match";
        mark.textContent = entry.label.slice(at, at + typed.length);
        text.append(entry.label.slice(0, at), mark, entry.label.slice(at + typed.length));
      } else text.textContent = entry.label;
      row.append(text);
      row.title = row.textContent;
      fragment.append(row);
    }
    if (end < shownOptions.length) fragment.append(spacer((shownOptions.length - end) * RESULT_HEIGHT));
    resultsBox.replaceChildren(fragment);
    updateActiveResult(false);
  }

  function updateActiveResult(scroll) {
    if (scroll && activeResult >= 0) {
      const top = activeResult * RESULT_HEIGHT;
      const bottom = top + RESULT_HEIGHT;
      if (top < resultsBox.scrollTop) resultsBox.scrollTop = top;
      else if (bottom > resultsBox.scrollTop + resultsBox.clientHeight) {
        resultsBox.scrollTop = bottom - resultsBox.clientHeight;
      }
      renderVisibleResults();
    }
    if (activeRow?.isConnected) activeRow.classList.remove("bw-active-result");
    activeRow = resultsBox.querySelector(`[data-bw-result-position="${activeResult}"]`);
    if (activeRow) {
      activeRow.classList.add("bw-active-result");
      searchInput.setAttribute("aria-activedescendant", activeRow.id);
    } else searchInput.removeAttribute("aria-activedescendant");
  }

  function onSearchKeydown(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      let next = activeResult;
      for (let attempts = 0; attempts < shownOptions.length; attempts++) {
        next = (next + direction + shownOptions.length) % shownOptions.length;
        if (!shownOptions[next].disabled) {
          activeResult = next;
          updateActiveResult(true);
          break;
        }
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeResult >= 0) chooseOption(shownOptions[activeResult].index);
    }
  }

  function chooseOption(index) {
    if (!openSelect) return;
    const select = openSelect;
    const option = select.options[index];
    const group = option?.parentElement;
    if (!option || select.matches(":disabled") || option.disabled ||
        (group?.tagName === "OPTGROUP" && group.disabled)) return;
    const changed = select.multiple ? true : select.selectedIndex !== index;
    if (select.multiple) option.selected = !option.selected;
    else select.selectedIndex = index;
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (select.multiple && select.isConnected) {
      collectOptions(select);
      renderResults();
      searchInput.focus();
    } else {
      closePopover(true);
    }
  }

  function menuRows(menu, wrapper) {
    let candidates = Array.from(menu.querySelectorAll(MENU_ITEM_SELECTOR)).filter(row =>
      !row.closest(".bw-menu-search") && row.closest(MENU_SELECTOR) === menu);
    if (!candidates.length) {
      candidates = Array.from(menu.children).filter(row => row !== wrapper &&
        (row.matches("a, button, [role='option'], [role='menuitem'], " +
          "[class*='option' i], [class*='menu-item' i], " +
          "[class*='menuitem' i], [class*='dropdown-item' i]") ||
         (row.matches("li") && Boolean(row.querySelector("a, button, [role='option'], [role='menuitem']")))));
    }
    if (menu.getAttribute("role") === "listbox") return candidates;

    const topRows = [...new Set(candidates.map(row => {
      let top = row;
      while (top.parentElement && top.parentElement !== menu) top = top.parentElement;
      return top;
    }))];
    return topRows.length > 1 ? topRows : candidates;
  }

  function refreshMenu(menu) {
    const info = menuInfo.get(menu);
    if (!info) return;
    if (!menu.contains(info.wrapper)) {
      info.input.value = "";
      menu.prepend(info.wrapper);
    }
    const rows = menuRows(menu, info.wrapper);
    info.entries = rows.filter(row => row !== info.wrapper &&
      row.textContent.trim()).map(row => ({ row, text: normalize(row.textContent) }));
    filterMenu(info);
  }

  function filterMenu(info) {
    const query = normalize(info.input.value);
    for (const entry of info.entries) {
      entry.row.classList.toggle("bw-filtered-out", Boolean(query) && !entry.text.includes(query));
    }
  }

  function enhanceMenu(menu) {
    // .cp-dl: the extension's own pick lists (forms.js) are listboxes with their own filter field.
    if (menuInfo.has(menu) || menu.closest(".bw-search-popover, .bw-menu-search, .cp-dl")) return;
    if (menu.querySelector("input[type='search'], input[role='combobox']")) return;
    const rows = menuRows(menu, null);
    if (rows.length < 2) return;

    const wrapper = document.createElement(menu.matches("ul, ol") ? "li" : "div");
    wrapper.className = "bw-menu-search" + (wrapper.tagName === "LI" ? " bw-menu-search-li" : "");
    wrapper.dataset.bwTheme = isDarkBackground(menu) ? "dark" : "light";
    wrapper.setAttribute("role", "presentation");
    const input = document.createElement("input");
    input.type = "search";
    input.className = "bw-menu-search-input";
    input.placeholder = "Search this menu";
    input.setAttribute("aria-label", "Search this menu");
    wrapper.append(input);
    menu.prepend(wrapper);
    const info = { wrapper, input, entries: [] };
    menuInfo.set(menu, info);
    refreshMenu(menu);
    input.addEventListener("input", () => filterMenu(info));
    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        input.value = "";
        filterMenu(info);
        input.blur();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
      } else {
        event.stopPropagation();
      }
    });
    menu.addEventListener("click", event => {
      if (wrapper.contains(event.target)) return;
      input.value = "";
      filterMenu(info);
    });
  }

  function scanRoot(root) {
    if (!(root instanceof Element) || root.closest(".bw-search-popover")) return;
    if (root.matches("a.navMenuitem, a.navMenuItem")) colorize(root);
    root.querySelectorAll("a.navMenuitem, a.navMenuItem").forEach(colorize);
    // Every dropdown gets the searchable list. The Users search keeps its menus as they are (their filter field
    // would join its form).
    if (root.matches("select")) enhanceSelect(root);
    root.querySelectorAll("select").forEach(enhanceSelect);
    if (!isUsersSearchPage()) {
      if (root.matches(MENU_SELECTOR)) enhanceMenu(root);
      root.querySelectorAll(MENU_SELECTOR).forEach(enhanceMenu);
    }
    if (root.matches("td.headerBar, span.headerAuthLevel, input#extension") ||
        root.querySelector("td.headerBar, span.headerAuthLevel, input#extension")) {
      syncCopyControls();
    }
  }

  function flushScans() {
    scanScheduled = false;
    for (const root of pendingRoots) if (root.isConnected) scanRoot(root);
    pendingRoots.clear();
    for (const menu of pendingMenus) if (menu.isConnected) refreshMenu(menu);
    pendingMenus.clear();
    for (const [select, info] of selectInfo) {
      if (select.isConnected) continue;
      if (openSelect === select) closePopover(false);
      info.attributeObserver.disconnect();
      info.resizeObserver.disconnect();
      select.removeEventListener("click", info.onSelectClick);
      select.removeEventListener("change", info.onSelectChange);
      if (select.getAttribute("tabindex") === "-1") {
        if (info.original.tabIndex === null) select.removeAttribute("tabindex");
        else select.setAttribute("tabindex", info.original.tabIndex);
      }
      if (select.getAttribute("aria-hidden") === "true") {
        if (info.original.ariaHidden === null) select.removeAttribute("aria-hidden");
        else select.setAttribute("aria-hidden", info.original.ariaHidden);
      }
      if (select.style.pointerEvents === "none") {
        select.style.pointerEvents = info.original.pointerEvents;
      }
      if (info.original.searchable === null) select.removeAttribute("data-bw-searchable");
      else select.setAttribute("data-bw-searchable", info.original.searchable);
      // Unwrap, never remove: CommPilot swaps a select for a new one in place (the Users search rebuilds
      // findOp0 with `old.parentNode.replaceChild(new, old)`), so the new one lands inside this shell. Removing
      // the shell would delete it, and the search would go out without it (HTTP 500).
      info.trigger.remove();
      if (info.shell.isConnected) info.shell.replaceWith(...info.shell.childNodes);
      selectInfo.delete(select);
    }
    for (const menu of menuInfo.keys()) if (!menu.isConnected) menuInfo.delete(menu);
    if (pendingOptionRefresh && openSelect) {
      collectOptions(openSelect);
      renderResults();
    }
    pendingOptionRefresh = false;
    pendingCleanup = false;
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(flushScans);
  }

  function onMutations(records) {
    // A list's rows taken out and put back in the same batch are a sort (lists.js): they were on the page already,
    // and a swept list moves thousands of them at once, so they are not scanned again.
    const first = new Map();
    for (const record of records) {
      for (const node of record.removedNodes) if (!first.has(node)) first.set(node, "removed");
      for (const node of record.addedNodes) if (!first.has(node)) first.set(node, "added");
    }
    const moved = node => node.localName === "tr" && first.get(node) === "removed" && node.isConnected;
    const looked = new Set();   // what depends on where a change is, once per element (a sort's rows share one tbody)
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE
        ? record.target : record.target.parentElement;
      if (!target || target.closest(".bw-search-popover")) continue;
      if (record.type !== "childList" || !looked.has(target)) {
        if (record.type === "childList") looked.add(target);
        const menu = target.closest(MENU_SELECTOR);
        if (menu) {
          if (menuInfo.has(menu)) pendingMenus.add(menu);
          else if (record.type === "childList") pendingRoots.add(menu);
        }
        const select = target.closest("select");
        if (select && select === openSelect) pendingOptionRefresh = true;
        const anchor = target.closest("a.navMenuitem, a.navMenuItem");
        if (anchor) pendingRoots.add(anchor);
        const header = target.closest("td.headerBar");
        if (header && !target.closest(".bw-copy-controls, .cp-copy-id, .cp-ext-chip")) pendingRoots.add(header);
      }
      if (record.type === "childList") {
        for (const removed of record.removedNodes) {
          if (removed.nodeType === Node.ELEMENT_NODE && !moved(removed) &&
              (removed.matches("select, .bw-select-shell, " + MENU_SELECTOR) ||
               removed.querySelector("select, .bw-select-shell, " + MENU_SELECTOR))) {
            pendingCleanup = true;
          }
        }
        for (const added of record.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE && !moved(added) &&
              !added.closest(".bw-search-popover, .bw-menu-search")) {
            pendingRoots.add(added);
          }
        }
      }
    }
    if (pendingRoots.size || pendingMenus.size || pendingOptionRefresh || pendingCleanup) scheduleScan();
  }

  function initialize() {
    if (!document.documentElement || !document.body) return;
    new MutationObserver(onMutations).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
    scanRoot(document.documentElement);
    // pjax.js marks the user's extension read on the id element; the palette can be switched on or off.
    for (const name of ["cp:user-extension", "cp:theme-change"]) {
      document.addEventListener(name, () => requestAnimationFrame(syncCopyControls));
    }
    document.addEventListener("click", noteListedExtension, true);
    document.addEventListener("pointerdown", event => {
      if (!openSelect || popover.contains(event.target)) return;
      const info = selectInfo.get(openSelect);
      if (info && (info.trigger.contains(event.target) || openSelect.contains(event.target))) return;
      closePopover(false);
    }, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && openSelect && !popover.contains(event.target)) {
        closePopover(false);
      }
    }, true);
    document.addEventListener("focusin", event => {
      if (!openSelect || popover.contains(event.target)) return;
      const info = selectInfo.get(openSelect);
      if (!info || (!info.trigger.contains(event.target) && !openSelect.contains(event.target))) {
        closePopover(false);
      }
    }, true);
    window.addEventListener("scroll", positionPopover, true);
    window.addEventListener("resize", positionPopover);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
