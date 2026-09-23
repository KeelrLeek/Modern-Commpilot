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
  let resultsBox;
  let openSelect = null;
  let shownOptions = [];
  let activeResult = -1;
  let activeRow = null;
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

  function cachedExtension(context) {
    try {
      return sessionStorage.getItem(context.cacheKey) || "";
    } catch (_) {
      return "";
    }
  }

  function rememberExtension(context, value) {
    try {
      if (value) sessionStorage.setItem(context.cacheKey, value);
      else sessionStorage.removeItem(context.cacheKey);
    } catch (_) {
      // The current Addresses field can still be copied if storage is blocked.
    }
  }

  function extensionFor(context) {
    const visible = displayedExtension(context);
    return visible === null ? cachedExtension(context) : visible;
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

  function syncCopyControls() {
    const context = userBreadcrumb();
    if (!context) return;
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
    const button = toolbar.querySelector('[data-bw-copy="extension"]');
    const available = !!extensionFor(context);
    button.disabled = !available;
    button.title = available ? "Copy this user's extension" :
      "Open Profile > Addresses to load this user's extension";
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
    info.trigger.disabled = select.matches(":disabled");
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

    const trigger = document.createElement("button");
    trigger.type = "button";
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

    popover.append(searchInput, summary, resultsBox);
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
    const width = Math.min(420, Math.max(280, rect.width), window.innerWidth - 16);
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
    searchInput.value = "";
    popover.hidden = false;
    positionPopover();
    renderResults();
    searchInput.focus();
  }

  function closePopover(restoreFocus) {
    if (!openSelect) return;
    const info = selectInfo.get(openSelect);
    openSelect = null;
    shownOptions = [];
    activeResult = -1;
    activeRow = null;
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
    const fragment = document.createDocumentFragment();
    shownOptions = [];

    for (const entry of info.options) {
      if (!entry.searchable.includes(query)) continue;
      shownOptions.push(entry);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "bw-search-result";
      row.id = "bw-search-option-" + entry.index;
      row.dataset.bwOptionIndex = String(entry.index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(Boolean(openSelect.options[entry.index]?.selected)));
      row.disabled = entry.disabled;
      row.textContent = entry.groupLabel
        ? entry.groupLabel + " — " + entry.label : entry.label;
      fragment.append(row);
    }

    resultsBox.replaceChildren(fragment);
    activeRow = null;
    const matchCount = shownOptions.length;
    summary.textContent = matchCount === 0 ? "No matching options" :
      matchCount + (matchCount === 1 ? " matching option" : " matching options");
    activeResult = shownOptions.findIndex(entry => !entry.disabled &&
      Boolean(openSelect.options[entry.index]?.selected));
    if (activeResult < 0) activeResult = shownOptions.findIndex(entry => !entry.disabled);
    updateActiveResult(false);
  }

  function updateActiveResult(scroll) {
    if (activeRow?.isConnected) activeRow.classList.remove("bw-active-result");
    const active = resultsBox.children[activeResult];
    activeRow = active || null;
    if (active) {
      active.classList.add("bw-active-result");
      searchInput.setAttribute("aria-activedescendant", active.id);
      if (scroll) active.scrollIntoView({ block: "nearest" });
    } else {
      searchInput.removeAttribute("aria-activedescendant");
    }
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
    if (menuInfo.has(menu) || menu.closest(".bw-search-popover, .bw-menu-search")) return;
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
    if (!isUsersSearchPage()) {
      if (root.matches("select")) enhanceSelect(root);
      root.querySelectorAll("select").forEach(enhanceSelect);
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
      info.trigger.remove();
      info.shell.remove();
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
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE
        ? record.target : record.target.parentElement;
      if (!target || target.closest(".bw-search-popover")) continue;
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
      if (header && !target.closest(".bw-copy-controls")) pendingRoots.add(header);
      if (record.type === "childList") {
        for (const removed of record.removedNodes) {
          if (removed.nodeType === Node.ELEMENT_NODE &&
              (removed.matches("select, .bw-select-shell, " + MENU_SELECTOR) ||
               removed.querySelector("select, .bw-select-shell, " + MENU_SELECTOR))) {
            pendingCleanup = true;
          }
        }
        for (const added of record.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE &&
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
