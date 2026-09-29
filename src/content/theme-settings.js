/* The Settings window (the header's Settings button): the CommPilot palette, the site's font and the extension's
   other settings, kept in sync across tabs and PJAX views. It opens centred over the page, like the sign-out
   confirmation. Settings other than the palette live in chrome.storage.local "cpSettings" and are mirrored onto
   <html> for the page and the other scripts (pjax.js runs in the page and cannot read extension storage):
   data-cp-font (fonts.js applies it to every element), data-cp-peek="off", data-cp-side="rail".
   It also runs the sidebar's Menu header: its button folds the menu to its icons (remembered as "side") and
   <html data-cp-rail> marks the rail whenever it shows, folded by hand or on a window under 1100px. And the top
   bar's account button (mockup pick B): who is signed in, with Sign out in its menu. The Settings window ends with
   About: the version, the site, what is new, and a button that copies build details for a bug report. */
(() => {
  const key = "cpThemePalette";
  const choices = new Set(["nord", "atlas", "graphite", "terra"]);
  const paletteNames = { nord: "Nord", atlas: "Atlas", graphite: "Graphite", terra: "Terra" };
  const settingsKey = "cpSettings";
  const defaults = { peek: true, font: "inter", side: "full" };
  const narrow = matchMedia("(max-width: 1100px)");
  const fonts = globalThis.cpFontChoices || [];   // fonts.js, loaded just before this script
  let settings = { ...defaults };
  let shellFrame = 0;
  let currentPalette = "atlas";
  let panel, overlay;

  // CommPilot gives the page PJAX starts from <body id="initBody.menuTemplate">, but a content page opened
  // directly (the browser Reload button replays the page with a plain POST) comes back around the same shell
  // as <body id="initBody">. The theme, PJAX's page layouts and the Appearance control all key off the menu
  // template's id, so the same shell gets that id while the page is still parsing, before it paints. Pages
  // without CommPilot's left navigation form (Login, error pages) and pages with another id are left alone.
  function adoptShell() {
    const body = document.body;
    if (window !== window.top || !body || body.id === "initBody.menuTemplate") return Boolean(body);
    if (!/^initBody(\.|$)/.test(body.id)) return true;
    if (!document.querySelector('form[name="leftNavForm"]')) return false;
    body.id = "initBody.menuTemplate";
    return true;
  }
  try {
    if (!adoptShell() && document.readyState === "loading") {
      // At document_start even <html> may not exist yet, so watch the document itself.
      const watch = new MutationObserver(() => { if (adoptShell()) watch.disconnect(); });
      watch.observe(document, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", () => { watch.disconnect(); adoptShell(); }, { once: true });
    }
  } catch (error) { console.warn("[CommPilot] shell", error); }

  // The palette can arrive before <html> exists (document_start).
  function withRoot(fn) {
    if (document.documentElement) { fn(document.documentElement); return; }
    const wait = new MutationObserver(() => {
      if (document.documentElement) { wait.disconnect(); fn(document.documentElement); }
    });
    wait.observe(document, { childList: true });
  }

  function syncControls() {
    const button = document.getElementById("cp-appearance-toggle");
    if (button) button.title = `Settings · ${paletteNames[currentPalette]}`;
    if (!panel?.isConnected) return;
    for (const option of panel.querySelectorAll('input[name="cp-palette"]')) {
      option.checked = option.value === currentPalette;
    }
    panel.querySelector('input[name="peek"]').checked = settings.peek;
    for (const option of panel.querySelectorAll('input[name="cp-font"]')) option.checked = option.value === settings.font;
  }

  function applySettings(value) {
    settings = { ...defaults, ...(value && typeof value === "object" ? value : {}) };
    settings.peek = settings.peek !== false;
    if (!fonts.some(f => f.id === settings.font)) settings.font = defaults.font;
    if (settings.side !== "rail") settings.side = "full";
    withRoot(root => {
      root.setAttribute("data-cp-font", settings.font);
      if (settings.side === "rail") root.setAttribute("data-cp-side", "rail");
      else root.removeAttribute("data-cp-side");
      applyRail();
      if (settings.peek) root.removeAttribute("data-cp-peek");
      else root.setAttribute("data-cp-peek", "off");
      document.dispatchEvent(new Event("cp:settings-change"));
      syncControls();
    });
  }

  function saveSettings(patch, message) {
    const previous = settings;
    applySettings({ ...settings, ...patch });
    const status = panel?.querySelector(".cp-appearance-status");   // the sidebar's fold button saves without the window
    if (status) status.textContent = "Saving…";
    chrome.storage.local.set({ [settingsKey]: settings }, () => {
      if (chrome.runtime?.lastError) {
        applySettings(previous);
        if (status) status.textContent = "Could not save. Try again.";
      } else if (status) status.textContent = message;
    });
  }

  // The sidebar folded to its icons: by its button (settings.side) or always on a small window, where the names
  // would not fit beside the page.
  function applyRail() {
    withRoot(root => {
      root.toggleAttribute("data-cp-rail", settings.side === "rail" || narrow.matches);
      root.toggleAttribute("data-cp-rail-forced", narrow.matches);
      const button = document.querySelector(".cp-side-toggle");
      if (button) {
        const folded = settings.side === "rail";
        const label = folded ? "Expand the menu" : "Collapse the menu";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-expanded", String(!folded));
      }
      hideTip();
    });
  }
  // A fold by the button or by the window crossing 1100px is animated (theme-palettes.css, while <html
  // data-cp-rail-anim>); a page opening folded is not. Lists and the board refit once the sidebar has its width.
  let railAnim = 0;
  function animateRail(change) {
    const root = document.documentElement;
    root.setAttribute("data-cp-rail-anim", "");
    change();
    clearTimeout(railAnim);
    railAnim = setTimeout(() => {
      root.removeAttribute("data-cp-rail-anim");
      window.dispatchEvent(new Event("resize"));
    }, 300);
  }
  narrow.addEventListener("change", () => animateRail(applyRail));

  // The Menu header in CommPilot's "Options:" cell (theme-palettes.css hides that word).
  const FOLD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg>';
  function attachSideMenu() {
    const cell = document.querySelector('form[name="leftNavForm"] td.navOptions');
    if (!cell || cell.querySelector(".cp-side-menu")) return;
    const bar = document.createElement("div");
    bar.className = "cp-side-menu";
    bar.innerHTML = '<span class="cp-side-menu-label">Menu</span>' +
      `<button type="button" class="cp-side-toggle" aria-controls="cp-side-nav">${FOLD}</button>`;
    cell.appendChild(bar);
    cell.closest("form").id ||= "cp-side-nav";
    applyRail();
  }

  // Folded, a folder's name shows beside its icon while it is pointed at or has keyboard focus.
  let tip = null;
  const sideLink = target => target?.closest?.('form[name="leftNavForm"] :is(a.leftnavfolder, a.leftnavfolderopen)');
  function showTip(link) {
    if (!document.documentElement.hasAttribute("data-cp-rail")) return;
    if (!tip?.isConnected) {
      tip = document.createElement("div");
      tip.id = "cp-side-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    const r = link.getBoundingClientRect();
    tip.textContent = link.textContent.replace(/\s+/g, " ").trim();
    tip.style.setProperty("left", `${Math.round(r.right + 10)}px`);
    tip.style.setProperty("top", `${Math.round(r.top + r.height / 2)}px`);
    tip.hidden = false;
  }
  function hideTip() { if (tip) tip.hidden = true; }
  document.addEventListener("pointerover", event => { const link = sideLink(event.target); if (link) showTip(link); });
  document.addEventListener("pointerout", event => {
    if (sideLink(event.target) && sideLink(event.target) !== sideLink(event.relatedTarget)) hideTip();
  });
  document.addEventListener("focusin", event => { const link = sideLink(event.target); if (link) showTip(link); else hideTip(); });
  document.addEventListener("scroll", hideTip, { capture: true, passive: true });

  function apply(value) {
    const palette = value === "midnight" ? "nord" : choices.has(value) ? value : "atlas";
    currentPalette = palette;
    withRoot(root => { root.dataset.cpDirection = palette; });
    syncControls();
    document.dispatchEvent(new CustomEvent("cp:theme-change", { detail: { palette } }));
    scheduleShellMeasure();
  }

  function isOpen() { return Boolean(overlay?.isConnected && !overlay.hidden); }

  function openPanel() {
    ensurePanel();
    syncControls();
    // About is in the window, so this version's news has been seen: the logo's dot loses its ring (brand.js).
    const brand = globalThis.cpBrand;
    if (brand) chrome.storage.local.set({ [brand.seenKey]: brand.version });
    panel.querySelector(".cp-appearance-status").textContent = "";
    overlay.hidden = false;
    document.getElementById("cp-appearance-toggle")?.setAttribute("aria-expanded", "true");
    (panel.querySelector('input[name="cp-palette"]:checked') || panel.querySelector(".cp-settings-close")).focus();
  }

  function closePanel() {
    if (!isOpen()) return;
    overlay.hidden = true;
    const button = document.getElementById("cp-appearance-toggle");
    button?.setAttribute("aria-expanded", "false");
    if (button?.isConnected) button.focus();
  }

  const row = (control, title, detail) => '<label class="cp-settings-row"><span class="cp-settings-text">' +
    `<strong>${title}</strong><span>${detail}</span></span>${control}</label>`;
  const toggle = name => `<input type="checkbox" class="cp-settings-switch" name="${name}" role="switch">`;

  const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 ' +
    '0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 ' +
    '2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 ' +
    '1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 ' +
    '1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 ' +
    '0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

  // What is new in each version (About, in the Settings window). Plain text; the newest version first.
  const NEWS = {
    "0.3.76": [
      "Too many results? A search CommPilot refuses as too broad now offers Load all, which searches a few letters at a time until every match is in.",
      "While it loads you see the search it is working through, a bar and count, and each letter as it is searched. Cancel keeps what was loaded so far.",
      "The loaded list pages and sorts like any other list, and stays quick with thousands of users.",
      "A message at the bottom says what was loaded; if some could not be reached by name, its button finds them by User ID.",
      "Long lists turn pages and sort much faster.",
    ],
    "0.3.75": [
      "A new CommPilot logo, the same on every CommPilot site. It shows the version and which site you are on, and takes you Home.",
      "The logo’s heartbeat is the loading bar: it runs along while a page or search loads and pulses when it lands.",
      "The browser tab and the toolbar icon take your palette’s colours; sandbox tabs are outlined and badged SBX.",
      "Settings is a window, with one font for the whole site (15 to choose from) and this About section.",
      "Page headers show the page’s icon, its buttons grouped, and an info button for its description.",
      "Messages appear at the bottom of the screen and go away on their own.",
      "The sidebar folds to its icons (animated, and remembered), and folds itself on a small window.",
      "The top bar never wraps: your account menu holds Sign out, and the breadcrumb folds into “…” when long.",
    ],
  };
  function about() {
    const brand = globalThis.cpBrand;
    if (!brand) return "";
    const news = (NEWS[brand.version] || []).map(item => `<li>${item}</li>`).join("");
    return '<section class="cp-settings-section cp-about" aria-label="About"><h3>About</h3>' +
      '<div class="cp-about-app"><div class="cp-about-name">' +
      `<strong>CommPilot Enhancer ${brand.version}</strong><span>${brand.hostname}</span></div>` +
      '<button type="button" class="cp-about-copy">Copy build info</button></div>' +
      (news ? `<h4>What’s new in ${brand.version}</h4><ul class="cp-about-news">${news}</ul>` : "") + "</section>";
  }
  // Details for a bug report: which build, where, and how the page was set up.
  function copyBuildInfo() {
    const brand = globalThis.cpBrand || {};
    const font = fonts.find(f => f.id === settings.font);
    const text = [`CommPilot Enhancer ${brand.version || chrome.runtime.getManifest().version}`,
      `Site: ${location.hostname} (${brand.envName || "?"})`, `Palette: ${paletteNames[currentPalette]}`,
      `Font: ${font?.label || settings.font}`, `Menu previews: ${settings.peek ? "on" : "off"}`,
      `Page: ${location.pathname}`, `Browser: ${navigator.userAgent}`].join("\n");
    const status = panel.querySelector(".cp-appearance-status");
    navigator.clipboard.writeText(text).then(
      () => { status.textContent = "Build info copied. Paste it into your message."; },
      () => { status.textContent = "Could not copy. Try again."; });
  }

  function ensurePanel() {
    if (overlay?.isConnected) return panel;
    overlay = document.createElement("div");
    overlay.className = "cp-settings-overlay";
    overlay.hidden = true;
    panel = document.createElement("section");
    panel.id = "cp-appearance-panel";
    panel.className = "cp-settings-dialog";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "cp-settings-title");
    // The window's icon is the CommPilot tile (brand.js), in the palette's colours.
    const tile = globalThis.cpBrand?.tile;
    panel.innerHTML = '<header class="cp-settings-head">' +
      (tile ? `<span class="cp-settings-icon cp-settings-pulse">${tile}</span>` : `<span class="cp-settings-icon">${GEAR}</span>`) +
      '<div class="cp-settings-heading"><h2 id="cp-settings-title">Settings</h2><span>Saved across CommPilot tabs</span></div>' +
      '<button type="button" class="cp-settings-close" aria-label="Close settings">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M18 6 6 18M6 6l12 12"/></svg></button></header><div class="cp-settings-body">' +
      '<section class="cp-settings-section" aria-label="Appearance"><h3>Appearance</h3>' +
      '<fieldset><legend class="cp-appearance-sr-only">Color palette</legend>' +
      Object.entries(paletteNames).map(([value, label]) =>
        `<label class="cp-appearance-option"><input type="radio" name="cp-palette" value="${value}">` +
        `<span class="cp-appearance-swatch cp-appearance-swatch-${value}" aria-hidden="true"></span>` +
        `<span>${label}</span><span class="cp-appearance-check" aria-hidden="true">✓</span></label>`
      ).join("") + '</fieldset></section>' +
      '<section class="cp-settings-section" aria-label="Font"><h3>Font</h3>' +
      '<p class="cp-settings-lede">One font for the whole site: titles, menus, lists and forms.</p>' +
      '<fieldset class="cp-font-grid"><legend class="cp-appearance-sr-only">Font</legend>' +
      fonts.map(f => `<label class="cp-font-option" data-font="${f.id}"><input type="radio" name="cp-font" value="${f.id}">` +
        `<span class="cp-font-name cp-font-sample">${f.label}</span>` +
        `<span class="cp-font-line cp-font-sample">Call Forwarding · 205-555-0102</span>` +
        `<span class="cp-font-note">${f.note || ""}</span><span class="cp-appearance-check" aria-hidden="true">✓</span></label>`).join("") +
      '</fieldset></section>' +
      '<section class="cp-settings-section" aria-label="Background loading"><h3>Background loading</h3>' +
      row(toggle("peek"), "Menu previews",
        "Show a few settings under menu options. Turn off if a large group&rsquo;s menus feel slow.") +
      '</section>' + about() + '</div><footer class="cp-settings-foot"><span class="cp-appearance-status" role="status" aria-live="polite"></span>' +
      '<button type="button" class="cp-settings-done">Done</button></footer>';
    // Each font previews in its own face (set here, not in markup: CommPilot's content policy blocks inline styles).
    for (const option of panel.querySelectorAll(".cp-font-option")) {
      const font = fonts.find(f => f.id === option.dataset.font);
      if (font) option.style.setProperty("--cp-font-preview", font.stack);
    }
    panel.querySelector(".cp-settings-close").addEventListener("click", closePanel);
    panel.querySelector(".cp-settings-done").addEventListener("click", closePanel);
    panel.querySelector(".cp-about-copy")?.addEventListener("click", copyBuildInfo);
    overlay.addEventListener("click", event => { if (event.target === overlay) closePanel(); });
    overlay.append(panel);
    document.body.append(overlay);
    syncControls();
    return panel;
  }

  function attachControl() {
    if (document.body?.id !== "initBody.menuTemplate") {
      if (isOpen()) overlay.hidden = true;
      document.getElementById("cp-appearance-toggle")?.remove();
      return;
    }
    const header = [...document.querySelectorAll("td.headerBar")]
      .find(cell => cell.querySelector("a.headerLink") && !cell.querySelector(".headerBarWelcome"));
    if (!header) return;
    let button = document.getElementById("cp-appearance-toggle");
    if (button?.parentElement !== header) button?.remove();
    if (!button?.isConnected) {
      button = document.createElement("button");
      button.id = "cp-appearance-toggle";
      button.type = "button";
      button.textContent = "Settings";
      try { button.style.setProperty("--cp-settings-gear", `url("${chrome.runtime.getURL("assets/icons/settings.svg")}")`); } catch (_) {}
      button.setAttribute("aria-controls", "cp-appearance-panel");
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      header.append(button);
    }
    // Their names show on hover when a narrow window leaves the header buttons only their icons.
    for (const link of header.querySelectorAll("a.headerLink")) if (!link.title) link.title = link.textContent.trim();
    syncControls();
    attachAccount(header);
    attachSideMenu();
  }

  // The account button: the person icon and your name (the icon alone on a narrow window, like the header's other
  // buttons), and a menu with Sign out. CommPilot's welcome cell and its Logout
  // link stay in the page, hidden (theme-palettes.css); Sign out presses that link, so logout-confirm.js still asks.
  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const SIGN_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M10 4.25H6.25a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2H10M14 8l4 4-4 4M8.75 12H18"/></svg>';
  const signedIn = () => (document.querySelector("td.headerBar .headerBarWelcome")?.textContent || "")
    .replace(/\u00a0/g, " ").replace(/^\s*Welcome\s*/i, "").replace(/\s+/g, " ").trim();
  const PERSON = '<svg class="cp-account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/>' +
    '<path d="M5 20v-1.25A5.25 5.25 0 0 1 10.25 13.5h3.5A5.25 5.25 0 0 1 19 18.75V20"/></svg>';
  let accountMenu = null;
  function attachAccount(header) {
    const name = signedIn();
    let button = document.getElementById("cp-account");
    if (!name) { button?.remove(); return; }
    if (button?.parentElement !== header) button?.remove();
    if (!button?.isConnected) {
      button = document.createElement("button");
      button.id = "cp-account";
      button.type = "button";
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", "cp-account-menu");
      header.append(button);
    }
    if (button.dataset.name === name) return;
    button.dataset.name = name;
    button.title = name;
    button.setAttribute("aria-label", `${name}: account menu`);
    button.innerHTML = PERSON + '<span class="cp-account-name"></span>' + CHEVRON.replace("<svg ", '<svg class="cp-account-more" ');
    button.querySelector(".cp-account-name").textContent = name;
  }
  function openAccount(button) {
    if (!accountMenu?.isConnected) {
      accountMenu = document.createElement("div");
      accountMenu.id = "cp-account-menu";
      accountMenu.setAttribute("role", "menu");
      accountMenu.hidden = true;
      accountMenu.innerHTML = `<div class="cp-account-who">${PERSON}<span><strong></strong><span>Signed in to CommPilot</span></span></div>` +
        `<button type="button" role="menuitem" class="cp-account-signout">${SIGN_OUT}Sign out</button>`;
      accountMenu.querySelector(".cp-account-signout").addEventListener("click", () => {
        closeAccount(false);
        // CommPilot's own Logout link (relabelled Sign out); logout-confirm.js asks before it runs.
        const link = [...document.querySelectorAll("td.headerBar:has(.headerBarWelcome) a.headerLink")]
          .find(a => /log\s*out|sign\s*out/i.test(a.dataset.cpOriginalLabel || a.textContent));
        link?.click();
      });
      document.body.append(accountMenu);
    }
    const name = signedIn();
    accountMenu.querySelector("strong").textContent = name;
    const site = globalThis.cpBrand?.env === "sandbox" ? " · Sandbox" : "";
    accountMenu.querySelector(".cp-account-who span span").textContent = `Signed in to CommPilot${site}`;
    const r = button.getBoundingClientRect();
    accountMenu.style.setProperty("top", `${Math.round(r.bottom + 8)}px`);
    accountMenu.style.setProperty("right", `${Math.round(innerWidth - r.right)}px`);
    accountMenu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    accountMenu.querySelector("button").focus();
  }
  function closeAccount(refocus) {
    if (!accountMenu || accountMenu.hidden) return false;
    accountMenu.hidden = true;
    const button = document.getElementById("cp-account");
    button?.setAttribute("aria-expanded", "false");
    if (refocus) button?.focus();
    return true;
  }

  document.addEventListener("click", event => {
    if (event.target.closest?.("#cp-appearance-toggle")) {
      if (isOpen()) closePanel(); else openPanel();
    }
    const account = event.target.closest?.("#cp-account");
    if (account) {
      if (accountMenu && !accountMenu.hidden) closeAccount(false); else openAccount(account);
    } else if (!event.target.closest?.("#cp-account-menu")) closeAccount(false);
    if (event.target.closest?.(".cp-side-toggle")) {
      animateRail(() => saveSettings({ side: settings.side === "rail" ? "full" : "rail" }));   // then lists refit
    }
    if (sideLink(event.target)) hideTip();
  });
  document.addEventListener("change", event => {
    const control = event.target;
    if (control.matches?.('#cp-appearance-panel input[name="cp-font"]')) {
      const font = fonts.find(f => f.id === control.value);
      if (font) saveSettings({ font: font.id }, `${font.label} is now the font across CommPilot.`);
      return;
    }
    if (control.matches?.('#cp-appearance-panel input[name="peek"]')) {
      saveSettings({ peek: control.checked }, `Menu previews ${control.checked ? "on" : "off"}. Applies to the next menu you open.`);
      return;
    }
    const option = event.target;
    if (!option.matches?.('#cp-appearance-panel input[name="cp-palette"]') || !choices.has(option.value)) return;
    const previous = currentPalette;
    apply(option.value);
    const status = panel.querySelector(".cp-appearance-status");
    status.textContent = "Saving…";
    chrome.storage.local.set({ [key]: option.value }, () => {
      if (chrome.runtime?.lastError) {
        apply(previous);
        status.textContent = "Could not save. Try again.";
      } else status.textContent = `${paletteNames[option.value]} saved across CommPilot tabs.`;
    });
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && closeAccount(true)) event.preventDefault(); });
  window.addEventListener("resize", () => closeAccount(false), { passive: true });

  // While the window is open: Escape closes it and Tab stays inside it.
  document.addEventListener("keydown", event => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePanel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll("button, input:not([type=\"radio\"]), input[type=\"radio\"]:checked, select")]
      .filter(el => !el.disabled && el.offsetParent !== null);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) return;
    if (!panel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, true);

  function measureShell() {
    shellFrame = 0;
    if (document.body?.id !== "initBody.menuTemplate") return;
    const shell = document.body.querySelector('table[height="100%"]');
    if (!shell) return;
    const top = Math.max(0, Math.round(shell.getBoundingClientRect().top));
    document.body.style.setProperty("--cp-shell-top", `${top}px`);
  }

  function scheduleShellMeasure() {
    if (shellFrame) cancelAnimationFrame(shellFrame);
    shellFrame = requestAnimationFrame(measureShell);
  }

  applyRail();   // a small window gets the rail before the page paints, ahead of the saved settings
  chrome.storage.local.get([key, settingsKey], values => {
    apply(values?.[key]);
    applySettings(values?.[settingsKey]);
    if (values?.[key] === "midnight") chrome.storage.local.set({ [key]: "nord" });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Object.hasOwn(changes, key)) apply(changes[key].newValue);
    if (Object.hasOwn(changes, settingsKey)) applySettings(changes[settingsKey].newValue);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { scheduleShellMeasure(); attachControl(); }, { once: true });
  } else { scheduleShellMeasure(); attachControl(); }
  for (const eventName of ["cp:morphed", "cp:reskin"]) {
    document.addEventListener(eventName, () => { scheduleShellMeasure(); requestAnimationFrame(attachControl); });
  }
  window.addEventListener("resize", scheduleShellMeasure, { passive: true });
})();
