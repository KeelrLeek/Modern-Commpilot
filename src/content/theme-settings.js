/* The Settings popup (the header's Settings button): the CommPilot palette and the extension's other settings,
   kept in sync across tabs and PJAX views. Settings other than the palette live in chrome.storage.local
   "cpSettings" and are mirrored onto <html> for the page scripts (pjax.js runs in the page and cannot read
   extension storage): data-cp-peek="off". */
(() => {
  const key = "cpThemePalette";
  const choices = new Set(["nord", "atlas", "graphite", "terra"]);
  const paletteNames = { nord: "Nord", atlas: "Atlas", graphite: "Graphite", terra: "Terra" };
  const settingsKey = "cpSettings";
  const defaults = { peek: true };
  let settings = { ...defaults };
  let shellFrame = 0;
  let currentPalette = "atlas";
  let panel;

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
  }

  function applySettings(value) {
    settings = { ...defaults, ...(value && typeof value === "object" ? value : {}) };
    settings.peek = settings.peek !== false;
    withRoot(root => {
      if (settings.peek) root.removeAttribute("data-cp-peek");
      else root.setAttribute("data-cp-peek", "off");
      document.dispatchEvent(new Event("cp:settings-change"));
      syncControls();
    });
  }

  function saveSettings(patch, message) {
    const previous = settings;
    applySettings({ ...settings, ...patch });
    const status = panel.querySelector(".cp-appearance-status");
    status.textContent = "Saving…";
    chrome.storage.local.set({ [settingsKey]: settings }, () => {
      if (chrome.runtime?.lastError) {
        applySettings(previous);
        status.textContent = "Could not save. Try again.";
      } else status.textContent = message;
    });
  }

  function apply(value) {
    const palette = value === "midnight" ? "nord" : choices.has(value) ? value : "atlas";
    currentPalette = palette;
    withRoot(root => { root.dataset.cpDirection = palette; });
    syncControls();
    document.dispatchEvent(new CustomEvent("cp:theme-change", { detail: { palette } }));
    scheduleShellMeasure();
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    document.getElementById("cp-appearance-toggle")?.setAttribute("aria-expanded", "false");
  }

  function positionPanel() {
    const button = document.getElementById("cp-appearance-toggle");
    if (!button || !panel || panel.hidden) return;
    const bounds = button.getBoundingClientRect();
    const width = panel.offsetWidth;
    panel.style.left = `${Math.max(8, Math.min(bounds.right - width, innerWidth - width - 8))}px`;
    panel.style.top = `${Math.min(bounds.bottom + 8, innerHeight - panel.offsetHeight - 8)}px`;
  }

  const row = (control, title, detail) => '<label class="cp-settings-row"><span class="cp-settings-text">' +
    `<strong>${title}</strong><span>${detail}</span></span>${control}</label>`;
  const toggle = name => `<input type="checkbox" class="cp-settings-switch" name="${name}" role="switch">`;

  function ensurePanel() {
    if (panel?.isConnected) return panel;
    panel = document.createElement("div");
    panel.id = "cp-appearance-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Settings");
    panel.hidden = true;
    panel.innerHTML = '<div class="cp-appearance-heading"><strong>Settings</strong><span>Saved across CommPilot tabs</span></div>' +
      '<section class="cp-settings-section" aria-label="Appearance"><h3>Appearance</h3>' +
      '<fieldset><legend class="cp-appearance-sr-only">Color palette</legend>' +
      Object.entries(paletteNames).map(([value, label]) =>
        `<label class="cp-appearance-option"><input type="radio" name="cp-palette" value="${value}">` +
        `<span class="cp-appearance-swatch cp-appearance-swatch-${value}" aria-hidden="true"></span>` +
        `<span>${label}</span><span class="cp-appearance-check" aria-hidden="true">✓</span></label>`
      ).join("") + '</fieldset></section>' +
      '<section class="cp-settings-section" aria-label="Background loading"><h3>Background loading</h3>' +
      row(toggle("peek"), "Menu previews",
        "Show a few settings under menu options. Turn off if a large group&rsquo;s menus feel slow.") +
      '</section><span class="cp-appearance-status" role="status" aria-live="polite"></span>';
    document.body.append(panel);
    syncControls();
    return panel;
  }

  function attachControl() {
    if (document.body?.id !== "initBody.menuTemplate") {
      closePanel();
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
      button.setAttribute("aria-controls", "cp-appearance-panel");
      button.setAttribute("aria-expanded", "false");
      header.append(button);
    }
    syncControls();
  }

  document.addEventListener("click", event => {
    if (event.target.closest?.("#cp-appearance-toggle")) {
      const popup = ensurePanel();
      popup.hidden = !popup.hidden;
      const button = document.getElementById("cp-appearance-toggle");
      button?.setAttribute("aria-expanded", String(!popup.hidden));
      if (!popup.hidden) {
        syncControls();
        positionPanel();
        popup.querySelector("input:checked")?.focus();
      }
    } else if (panel && !panel.hidden && !panel.contains(event.target)) closePanel();
  });
  document.addEventListener("change", event => {
    const control = event.target;
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
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel && !panel.hidden) {
      closePanel();
      document.getElementById("cp-appearance-toggle")?.focus();
    }
  });

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
  window.addEventListener("resize", () => { scheduleShellMeasure(); positionPanel(); }, { passive: true });
})();
