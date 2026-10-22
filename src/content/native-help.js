/* Help tips. The top bar's Help tips button takes the place of CommPilot's own Help (a manual nobody used; its link
   stays in the page, hidden) and turns tips on: pointing at, or tabbing to, a menu option, a sidebar or menu board
   section, a page's title or one of its settings then shows what it is for, from assets/help/help-content.json.
   Esc or the button turns them off.
   The tips are keyed by what does not change between customers:
     byName     a menu option's name (its path, "/User/CallForwardingAlways/"); a page's title uses its page's path
     bySection  a sidebar or menu board section by level, then its name ("User" → "Incoming Calls"): "Profile" is not the
                same thing for a reseller and for a user
     bySetting  a setting by its page's path, then its label ("/User/CallForwardingAlways/" → "Play Ring Reminder …")
   The debug view (Settings → Debug, <html data-cp-debug>) colours everything that could have a tip: green (the
   palette's On) where it has one, dashed red (its Off) where it has none yet. Its panel, dragged by its header to
   wherever suits and remembered there, counts them per kind (each kind's colours can be switched off), copies the
   missing ones as entries to paste into help-content.json, names what the pointer is on and its key (Alt+click copies
   its entry), and shows the page's details and the last page loads, with switches for pjax's console log and an
   outline of the forms still in CommPilot's own layout. */
(() => {
  "use strict";

  if (window !== window.top || !location.pathname.startsWith("/commpilot/")) return;
  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  if (!runtime?.getURL) return;

  const clean = text => String(text || "").replace(/\s+/g, " ").trim();
  const root = document.documentElement;
  const shell = () => document.body?.id === "initBody.menuTemplate";
  const content = () => document.querySelector('td[width="82%"]');
  // A page's or a menu option's key: "/commpilot/User/CF/Always/index.jsp" → "/User/CF/Always/". An Auto Attendant's,
  // Hunt Group's or Call Center's own name (key=…) goes, so one tip serves every one of them.
  const pathKey = url => {
    const path = String(url || "").trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/commpilot(?=\/)/i, "")
      .replace(/index\.jsp(?=$|\?)/i, "").replace(/([?&])key=[^&]*&?/i, "$1").replace(/[?&]$/, "");
    return path || "/";
  };
  // A page opened without its menu option's query (…/ServiceProviders/ for …/ServiceProviders/?enterprise=true).
  const byPath = (data, key) => {
    const bare = key.replace(/\?.*$/, "");
    for (const [name, entry] of Object.entries(data.byName || {})) if (name.replace(/\?.*$/, "") === bare) return entry;
    return null;
  };
  const pageKey = () => pathKey(root.getAttribute("data-cp-path") || location.pathname);
  // The level the page is for: the first part of most of its menus' paths (Reseller, ServiceProvider, Group, User), or,
  // on a page without menus, of its own path.
  const level = () => {
    const counts = {};
    for (const a of document.querySelectorAll("a.navMenuItem[name]")) {
      const m = /^\/([A-Za-z]+)\//.exec(a.getAttribute("name") || "");
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    const own = /^\/([A-Za-z]+)\//.exec(pageKey())?.[1];
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || (own && own !== "Common" ? own : "");
  };
  const settingLabel = el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll(".fx-req, script, style").forEach(node => node.remove());
    return clean(copy.textContent).replace(/:$/, "");
  };

  // What can have a tip, how each is named in help-content.json, and where its tip is.
  const KINDS = [
    { kind: "menu", label: "Menu options", name: "Menu option", selector: "a.navMenuItem[name]",
      key: el => pathKey(el.getAttribute("name")), find: (data, key) => data.byName?.[key] },
    { kind: "section", label: "Sections", name: "Section", selector: "a.leftnavfolder, a.leftnavfolderopen, .cp-console-head-name",
      key: el => clean(el.textContent), find: (data, key) => data.bySection?.[level()]?.[key] },
    { kind: "page", label: "Page title", name: "Page title",   // the title's words (forms.js's .cp-frame-title), not its buttons
      selector: 'td[width="82%"] td.screenName .cp-frame-title, td[width="82%"] td.screenName:not(:has(.cp-frame-title))',
      key: () => pageKey(), find: (data, key) => data.byName?.[key] || byPath(data, key) },
    { kind: "setting", label: "Settings", name: "Setting",   // forms.js's labels: a field's, a choice's, a checkbox's words
      selector: 'td[width="82%"] .fx :is(.fx-item > .fx-label:not(:empty), .fx-check-text)',
      key: el => settingLabel(el), find: (data, key) => data.bySetting?.[pageKey()]?.[key] },
  ];
  const SELECTOR = KINDS.map(k => k.selector).join(", ");
  const kindOf = el => KINDS.find(k => el.matches(k.selector));
  // A menu board option is a box of two rows, its title (the link) and its description (with its preview): anywhere in
  // the box stands for the option.
  const OPTION = ":scope > td > a.navMenuItem[name]";
  function targetFor(node) {
    if (!node?.closest) return null;
    const direct = node.closest(SELECTOR);
    if (direct) return direct;
    for (let row = node.closest(".cp-console-body tr"); row; row = row.parentElement?.closest(".cp-console-body tr")) {
      const link = row.querySelector(OPTION) || row.previousElementSibling?.querySelector(OPTION);
      if (link) return link;
    }
    return null;
  }
  const boxRows = link => {
    const row = link.parentElement?.parentElement;
    return row?.matches("tr") && row.closest(".cp-console-body") ? [row, row.nextElementSibling].filter(Boolean) : [];
  };

  let entries = null;
  let active = false;
  let tip = null, hoverTimer = 0, hovered = null;

  function entryFor(el) {
    const kind = kindOf(el);
    const key = kind && kind.key(el);
    return key && entries ? kind.find(entries, key) || null : null;
  }

  // The tip, beside the pointer (or under the element, from the keyboard).
  function hideTip() {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    hovered = null;
    if (tip) tip.hidden = true;
  }
  function showTip(entry, x, y) {
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "cp-native-help-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const body = document.createElement("span");
    body.textContent = entry.body;
    tip.replaceChildren(title, body);
    tip.hidden = false;
    const bounds = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - bounds.width - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(y + 14, innerHeight - bounds.height - 8)) + "px";
  }

  // The top bar's button, in the place of CommPilot's own Help link.
  const headerCell = () => [...document.querySelectorAll("td.headerBar")]
    .find(cell => cell.querySelector("a.headerLink") && !cell.querySelector(".headerBarWelcome"));
  const isHelpLink = link => /^\[?\s*help\s*\]?$/i.test(clean(link.dataset.cpOriginalLabel || link.textContent));
  function attachButton() {
    if (!shell()) return;
    const cell = headerCell();
    if (!cell) return;
    const native = [...cell.querySelectorAll("a.headerLink")].find(isHelpLink);
    if (native) native.dataset.cpNativeHelp = "";
    let button = document.getElementById("cp-help-tips");
    if (button?.parentElement === cell) return;
    button?.remove();
    button = document.createElement("button");
    button.id = "cp-help-tips";
    button.type = "button";
    button.textContent = "Help tips";
    button.title = "Help tips";   // its name when a narrow window shows only its icon; the toast explains
    button.setAttribute("aria-pressed", String(active));
    button.style.setProperty("--cp-help-icon", `url("${runtime.getURL("assets/icons/help.svg")}")`);
    if (native) native.before(button);
    else cell.prepend(button);
  }
  function setActive(value) {
    active = value;
    root.toggleAttribute("data-cp-help", active);
    document.getElementById("cp-help-tips")?.setAttribute("aria-pressed", String(active));
    if (!active) hideTip();
    scanSoon();
  }
  document.addEventListener("click", event => {
    if (event.target.closest?.("#cp-help-tips")) {
      setActive(!active);
      if (active) globalThis.cpToasts?.show({ severity: "info", title: "Help tips on",
        body: "Point at a menu option, a section or a setting to see what it is for. Esc turns them off." });
    }
  });

  document.addEventListener("mouseover", event => {
    if (!active || !entries) return;
    const el = targetFor(event.target);
    if (!el || el === hovered) return;
    hideTip();
    const entry = entryFor(el);
    if (!entry) return;
    hovered = el;
    const x = event.clientX, y = event.clientY;
    hoverTimer = setTimeout(() => { if (active && hovered === el) showTip(entry, x, y); }, 120);
  }, true);
  document.addEventListener("mouseout", event => {
    if (!active || !hovered || targetFor(event.target) !== hovered) return;
    if (event.relatedTarget && targetFor(event.relatedTarget) === hovered) return;
    hideTip();
  }, true);
  document.addEventListener("focusin", event => {
    if (!active || !entries || !event.target.closest) return;
    const el = event.target.closest(SELECTOR);
    const entry = el && entryFor(el);
    hideTip();
    if (!entry) return;
    const r = el.getBoundingClientRect();
    hovered = el;
    showTip(entry, r.left, r.bottom - 6);
  }, true);
  document.addEventListener("keydown", event => {
    if (active && event.key === "Escape") setActive(false);
  }, true);

  // Marks (for help mode's cues and the debug view's colours): data-cp-tip="yes" | "no", and data-cp-tip-kind, on
  // everything that could have a tip. Kept up to date while either is on, cleared when both are off.
  const debugOn = () => root.hasAttribute("data-cp-debug");
  let scanQueued = false;
  function scanSoon() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => { scanQueued = false; scan(); });
  }
  function scan() {
    const marking = (active || debugOn()) && entries && shell();
    const counts = Object.fromEntries(KINDS.map(k => [k.kind, { have: 0, all: 0, missing: [], seen: new Set() }]));
    const boxes = new Map();   // a menu board option's rows → "yes" | "no"
    for (const el of document.querySelectorAll(SELECTOR)) {
      const kind = marking && kindOf(el), key = kind && kind.key(el);
      if (!key || !el.getClientRects().length) { el.removeAttribute("data-cp-tip"); el.removeAttribute("data-cp-tip-kind"); continue; }
      const has = !!kind.find(entries, key);
      if (el.getAttribute("data-cp-tip") !== (has ? "yes" : "no")) el.setAttribute("data-cp-tip", has ? "yes" : "no");
      if (el.getAttribute("data-cp-tip-kind") !== kind.kind) el.setAttribute("data-cp-tip-kind", kind.kind);
      if (kind.kind === "menu") for (const row of boxRows(el)) boxes.set(row, has ? "yes" : "no");
      const count = counts[kind.kind];   // a menu option in the sidebar and on the board counts once
      if (count.seen.has(key)) continue;
      count.seen.add(key);
      count.all++;
      if (has) count.have++;
      else count.missing.push({ key, label: labelFor(el, kind) });
    }
    for (const row of document.querySelectorAll("tr[data-cp-tip-box]")) if (!boxes.has(row)) row.removeAttribute("data-cp-tip-box");
    for (const [row, has] of boxes) if (row.getAttribute("data-cp-tip-box") !== has) row.setAttribute("data-cp-tip-box", has);
    markNative();
    if (debugOn()) renderPanel(counts);
    lastCounts = counts;
  }
  const labelFor = (el, kind) => kind.kind === "setting" ? kind.key(el) : clean(el.textContent) || kind.key(el);

  // Stubs to paste into help-content.json, in its own shape.
  function stubs(missing) {
    const out = {};
    for (const { key, label } of missing.menu || []) (out.byName ||= {})[key] = { title: label, body: "" };
    for (const { key, label } of missing.page || []) (out.byName ||= {})[key] = { title: label, body: "" };
    for (const { key } of missing.section || []) ((out.bySection ||= {})[level() || "?"] ||= {})[key] = { title: key, body: "" };
    for (const { key } of missing.setting || []) ((out.bySetting ||= {})[pageKey()] ||= {})[key] = { title: key, body: "" };
    return JSON.stringify(out, null, 2);
  }
  function copy(text, what) {
    const done = ok => globalThis.cpToasts?.show(ok ? { severity: "info", body: `Copied ${what}.` } :
      { severity: "warning", body: "The browser did not allow copying. Try again." });
    navigator.clipboard?.writeText(text).then(() => done(true), () => done(false)) ?? done(false);
  }
  // Alt+click something highlighted: its entry alone.
  document.addEventListener("click", event => {
    if (!event.altKey || !debugOn() || !entries) return;
    const el = targetFor(event.target);
    if (!el) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const kind = kindOf(el), key = kind.key(el);
    copy(stubs({ [kind.kind]: [{ key, label: labelFor(el, kind) }] }), `the help entry for “${clean(el.textContent) || key}”`);
  }, true);

  // The inspector: pointing at something highlighted names its kind and its key in help-content.json, and says
  // whether it has a tip.
  let inspector = null;
  function inspect(el, x, y) {
    if (!inspector) {
      inspector = document.createElement("div");
      inspector.id = "cp-debug-inspect";
      inspector.setAttribute("aria-hidden", "true");
      document.body.append(inspector);
    }
    const kind = kindOf(el), key = kind.key(el), entry = kind.find(entries, key);
    const head = document.createElement("strong");
    head.textContent = `${kind.name} · ${entry ? "has a tip" : "no tip yet"}`;
    const code = document.createElement("code");
    code.textContent = kind.kind === "section" ? `${level() || "?"} › ${key}` : kind.kind === "setting" ? `${pageKey()} › ${key}` : key;
    const hint = document.createElement("span");
    hint.textContent = entry ? `“${entry.title}”` : "Alt+click copies its entry";
    inspector.replaceChildren(head, code, hint);
    inspector.classList.toggle("is-have", !!entry);
    inspector.hidden = false;
    const r = inspector.getBoundingClientRect();
    inspector.style.left = Math.max(8, Math.min(x + 14, innerWidth - r.width - 8)) + "px";
    inspector.style.top = Math.max(8, y - r.height - 12) + "px";   // above the pointer: a help tip goes below
  }
  const hideInspector = () => { if (inspector) inspector.hidden = true; };
  document.addEventListener("mousemove", event => {
    if (!debugOn() || !entries || !inspectOn()) return hideInspector();
    const el = targetFor(event.target);
    if (!el?.hasAttribute("data-cp-tip") || event.target.closest?.("#cp-debug") || hiddenKinds().includes(el.getAttribute("data-cp-tip-kind"))) return hideInspector();
    inspect(el, event.clientX, event.clientY);
  }, { passive: true });

  // Forms still in CommPilot's own layout (not redesigned by forms.js): the tables holding their controls.
  const store = {
    get: (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; } },
    set: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} },
  };
  const OPTIONS = "cpDebugView";   // { native, inspect, hide: [kinds], left, top, folded }
  const options = () => {
    const value = store.get(OPTIONS, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };
  const setOption = patch => store.set(OPTIONS, { ...options(), ...patch });
  const nativeOn = () => options().native === true;
  const inspectOn = () => options().inspect !== false;
  const hiddenKinds = () => Array.isArray(options().hide) ? options().hide : [];
  function markNative() {
    const want = debugOn() && nativeOn() && shell();
    const found = new Set();
    const cell = content();
    if (want && cell) {
      for (const control of cell.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
        if (!control.getClientRects().length) continue;
        if (control.closest(".fx, .fx-native, .cp-console, .cp-searchbar-wrap, .cp-modal, .cp-sweep, .cp-pager, .bw-select-shell")) continue;
        const table = control.closest("table");
        if (table && cell.contains(table) && !table.querySelector(":scope > tbody > tr > td.listHeader")) found.add(table);
      }
    }
    for (const table of document.querySelectorAll("[data-cp-debug-native]")) if (!found.has(table)) table.removeAttribute("data-cp-debug-native");
    for (const table of found) table.setAttribute("data-cp-debug-native", "");
  }
  function applyHidden() {
    const hide = debugOn() ? hiddenKinds() : [];
    if (hide.length) root.setAttribute("data-cp-debug-hide", hide.join(" "));
    else root.removeAttribute("data-cp-debug-hide");
  }

  // Page loads: pjax.js's <html data-cp-progress> from "on" to "done", the last few kept.
  let loadStart = 0, lastCounts = null;
  const loads = [];
  new MutationObserver(() => {
    const state = root.getAttribute("data-cp-progress");
    if (state === "on" && !loadStart) loadStart = performance.now();
    if (state === "done" && loadStart) {
      loads.unshift({ page: pageKey(), ms: Math.round(performance.now() - loadStart) });
      loads.length = Math.min(loads.length, 6);
      loadStart = 0;
      if (debugOn()) scanSoon();
    }
    if (!state) loadStart = 0;
  }).observe(root, { attributes: true, attributeFilter: ["data-cp-progress"] });

  // The debug panel: bottom left at first, then wherever it is dragged (by its header), folded or not; both kept.
  let panel = null;
  const LOG_KEY = "cpDebug";
  const logsOn = () => { try { return localStorage.getItem(LOG_KEY) === "1"; } catch (_) { return false; } };
  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function buildPanel() {
    panel = make("aside");
    panel.id = "cp-debug";
    panel.setAttribute("aria-label", "Debug view");
    panel.innerHTML = '<header class="cp-debug-head" title="Drag to move"><span class="cp-debug-grip" aria-hidden="true"></span>' +
      '<strong>Debug view</strong><button type="button" class="cp-debug-fold" aria-expanded="true" aria-label="Fold the panel"></button></header>' +
      '<div class="cp-debug-body"><section class="cp-debug-tips"><div class="cp-debug-total"></div>' +
      '<div class="cp-debug-meter" aria-hidden="true"><span></span></div>' +
      '<ul class="cp-debug-legend"><li class="is-have">Has a tip</li><li class="is-missing">No tip yet</li></ul>' +
      '<ul class="cp-debug-kinds" aria-label="Colour these"></ul>' +
      '<div class="cp-debug-actions"><button type="button" class="cp-debug-copy"></button></div>' +
      '<p class="cp-debug-hint">Point at anything coloured to see its key. Alt+click copies its entry.</p></section>' +
      '<dl class="cp-debug-page"></dl><details class="cp-debug-loads"><summary>Recent page loads</summary><ol></ol></details>' +
      '<div class="cp-debug-checks">' +
      '<label class="cp-debug-check"><input type="checkbox" name="inspect"> Show keys when pointing</label>' +
      '<label class="cp-debug-check"><input type="checkbox" name="native"> Outline CommPilot’s own forms</label>' +
      '<label class="cp-debug-check"><input type="checkbox" name="logs"> Log pjax to the console (from the next page)</label></div>' +
      '<div class="cp-debug-actions"><button type="button" class="cp-debug-report">Copy debug report</button></div></div>';
    const fold = panel.querySelector(".cp-debug-fold");
    const setFolded = folded => {
      panel.classList.toggle("is-folded", folded);
      fold.setAttribute("aria-expanded", String(!folded));
      fold.setAttribute("aria-label", folded ? "Open the panel" : "Fold the panel");
    };
    setFolded(options().folded === true);
    fold.addEventListener("click", () => { const folded = !panel.classList.contains("is-folded"); setFolded(folded); setOption({ folded }); place(); });
    panel.querySelector(".cp-debug-copy").addEventListener("click", () => {
      copy(stubs(Object.fromEntries(KINDS.map(k => [k.kind, lastCounts?.[k.kind]?.missing || []]))), "the missing help entries");
    });
    panel.querySelector(".cp-debug-report").addEventListener("click", () => copy(report(), "the debug report"));
    panel.addEventListener("change", event => {
      const input = event.target;
      if (input.name === "native") setOption({ native: input.checked });
      else if (input.name === "inspect") { setOption({ inspect: input.checked }); if (!input.checked) hideInspector(); }
      else if (input.name === "logs") { try { input.checked ? localStorage.setItem(LOG_KEY, "1") : localStorage.removeItem(LOG_KEY); } catch (_) {} }
      else if (input.dataset.kind) {
        const hide = new Set(hiddenKinds());
        input.checked ? hide.delete(input.dataset.kind) : hide.add(input.dataset.kind);
        setOption({ hide: [...hide] });
        applyHidden();
      }
      scanSoon();
    });
    // Dragging by the header (not its button); the panel stays inside the window.
    const head = panel.querySelector(".cp-debug-head");
    head.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const r = panel.getBoundingClientRect(), dx = event.clientX - r.left, dy = event.clientY - r.top;
      head.setPointerCapture(event.pointerId);
      panel.classList.add("is-dragging");
      const move = e => place(e.clientX - dx, e.clientY - dy);
      const end = () => {
        head.removeEventListener("pointermove", move);
        panel.classList.remove("is-dragging");
        const p = panel.getBoundingClientRect();
        setOption({ left: Math.round(p.left), top: Math.round(p.top) });
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("lostpointercapture", end, { once: true });
    });
    document.body.append(panel);
    place();
  }
  // Where the panel sits: where it was left, kept inside the window (or bottom left, the first time).
  function place(left, top) {
    if (!panel) return;
    const saved = options();
    left ??= saved.left;
    top ??= saved.top;
    const r = panel.getBoundingClientRect();
    if (left == null || top == null) { panel.style.removeProperty("left"); panel.style.removeProperty("top"); return; }
    panel.style.left = Math.round(Math.max(8, Math.min(left, innerWidth - r.width - 8))) + "px";
    panel.style.top = Math.round(Math.max(8, Math.min(top, innerHeight - Math.min(r.height, 40) - 8))) + "px";
    panel.style.bottom = "auto";
  }
  addEventListener("resize", () => place(), { passive: true });
  function renderPanel(counts) {
    if (!panel?.isConnected) buildPanel();
    const have = KINDS.reduce((n, k) => n + counts[k.kind].have, 0), all = KINDS.reduce((n, k) => n + counts[k.kind].all, 0);
    const missing = all - have;
    panel.querySelector(".cp-debug-total").textContent = `Help tips on this page: ${have} of ${all}`;
    panel.querySelector(".cp-debug-meter span").style.width = all ? `${(have / all * 100).toFixed(1)}%` : "0";
    const hide = hiddenKinds();
    panel.querySelector(".cp-debug-kinds").replaceChildren(...KINDS.filter(k => counts[k.kind].all).map(k => {
      const c = counts[k.kind];
      const li = make("li", c.have < c.all ? "is-missing" : "is-have");
      const label = make("label");
      const box = make("input");
      box.type = "checkbox";
      box.dataset.kind = k.kind;
      box.checked = !hide.includes(k.kind);
      label.append(box, make("span", "", k.label), make("b", "", `${c.have} of ${c.all}`));
      li.append(label);
      return li;
    }));
    const copyButton = panel.querySelector(".cp-debug-copy");
    copyButton.textContent = missing ? `Copy the ${missing} missing as JSON` : "Nothing missing here";
    copyButton.disabled = !missing;
    panel.querySelector(".cp-debug-page").replaceChildren(...pageDetails().flatMap(([name, value]) => [make("dt", "", name), make("dd", "", value)]));
    panel.querySelector(".cp-debug-loads ol").replaceChildren(...(loads.length ? loads.map(l => {
      const li = make("li");
      li.append(make("span", "", l.page), make("b", "", `${l.ms.toLocaleString()} ms`));
      return li;
    }) : [make("li", "cp-debug-none", "None yet: open a page.")]));
    panel.querySelector('input[name="native"]').checked = nativeOn();
    panel.querySelector('input[name="inspect"]').checked = inspectOn();
    panel.querySelector('input[name="logs"]').checked = logsOn();
  }
  function pageDetails() {
    const trail = [...document.querySelectorAll("td.headerBar a.headerAuthLevelLink, td.headerBar span.headerAuthLevel")]
      .map(el => clean(el.textContent)).filter(Boolean);
    return [
      ["Page", pageKey()],
      ["Level", level() || "—"],
      ["Where", trail.join(" › ") || "—"],
      ["Last load", loads.length ? `${loads[0].ms.toLocaleString()} ms` : "—"],
      ["Page size", `${document.getElementsByTagName("*").length.toLocaleString()} elements`],
      ["Build", `${runtime.getManifest().version} · ${root.dataset.cpDirection || "no palette"} · ${root.dataset.cpFont || "?"}`],
    ];
  }
  function report() {
    const counts = lastCounts || {};
    return [`CommPilot Enhancer debug report · ${new Date().toISOString()}`, `Site: ${location.hostname}`,
      ...pageDetails().map(([name, value]) => `${name}: ${value}`),
      `Help tips: ${KINDS.map(k => `${k.label.toLowerCase()} ${counts[k.kind]?.have ?? 0}/${counts[k.kind]?.all ?? 0}`).join(", ")}`,
      `Recent loads: ${loads.map(l => `${l.page} ${l.ms} ms`).join("; ") || "none"}`,
      `pjax log: ${logsOn() ? "on" : "off"}`, `Browser: ${navigator.userAgent}`].join("\n");
  }
  function debugChanged() {
    if (!debugOn()) {
      panel?.remove();
      panel = null;
      hideInspector();
    }
    applyHidden();
    scanSoon();
  }
  new MutationObserver(debugChanged).observe(root, { attributes: true, attributeFilter: ["data-cp-debug"] });
  applyHidden();

  // Pages, the menu board's sections and settings arrive after load: look again when the page changes (not when only
  // the tip, the panel or a toast did).
  const OWN = "#cp-debug, #cp-debug-inspect, #cp-native-help-tip, #cp-toasts";
  new MutationObserver(records => {
    if ((active || debugOn()) && records.some(r => !(r.target.closest?.(OWN) || r.target.parentElement?.closest(OWN)))) scanSoon();
  }).observe(document.documentElement, { childList: true, subtree: true });
  for (const name of ["cp:reskin", "cp:morphed", "cp:list-fill"]) {
    document.addEventListener(name, () => { hideTip(); setTimeout(() => { attachButton(); scanSoon(); }, 0); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachButton, { once: true });
  else attachButton();

  fetch(runtime.getURL("assets/help/help-content.json"))
    .then(response => {
      if (!response.ok) throw new Error("Help content HTTP " + response.status);
      return response.json();
    })
    .then(data => { entries = data; attachButton(); scanSoon(); })
    .catch(error => console.warn("[help tips] unavailable:", error));
})();
