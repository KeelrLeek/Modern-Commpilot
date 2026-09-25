/* Keep the selected CommPilot palette in sync across tabs and PJAX views. */
(() => {
  const key = "cpThemePalette";
  const choices = new Set(["midnight", "atlas", "graphite", "terra"]);
  const paletteNames = { midnight: "Midnight", atlas: "Atlas", graphite: "Graphite", terra: "Terra" };
  const root = document.documentElement;
  let shellFrame = 0;
  let currentPalette = "atlas";
  let panel;

  function syncControls() {
    const button = document.getElementById("cp-appearance-toggle");
    if (button) button.title = `Appearance · ${paletteNames[currentPalette]}`;
    if (!panel?.isConnected) return;
    for (const option of panel.querySelectorAll('input[name="cp-palette"]')) {
      option.checked = option.value === currentPalette;
    }
  }

  function apply(value) {
    const palette = choices.has(value) ? value : "atlas";
    currentPalette = palette;
    if (palette === "midnight") delete root.dataset.cpDirection;
    else root.dataset.cpDirection = palette;
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

  function ensurePanel() {
    if (panel?.isConnected) return panel;
    panel = document.createElement("div");
    panel.id = "cp-appearance-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Appearance settings");
    panel.hidden = true;
    panel.innerHTML = '<div class="cp-appearance-heading"><strong>Appearance</strong><span>Choose your CommPilot colors</span></div>' +
      '<fieldset><legend class="cp-appearance-sr-only">Color palette</legend>' +
      Object.entries(paletteNames).map(([value, label]) =>
        `<label class="cp-appearance-option"><input type="radio" name="cp-palette" value="${value}">` +
        `<span class="cp-appearance-swatch cp-appearance-swatch-${value}" aria-hidden="true"></span>` +
        `<span>${label}</span><span class="cp-appearance-check" aria-hidden="true">✓</span></label>`
      ).join("") + '</fieldset><span class="cp-appearance-status" role="status" aria-live="polite">Saved across CommPilot tabs.</span>';
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
      button.textContent = "Appearance";
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
        positionPanel();
        popup.querySelector("input:checked")?.focus();
      }
    } else if (panel && !panel.hidden && !panel.contains(event.target)) closePanel();
  });
  document.addEventListener("change", event => {
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

  chrome.storage.local.get(key, values => apply(values?.[key]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, key)) apply(changes[key].newValue);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { scheduleShellMeasure(); attachControl(); }, { once: true });
  } else { scheduleShellMeasure(); attachControl(); }
  for (const eventName of ["cp:morphed", "cp:reskin"]) {
    document.addEventListener(eventName, () => { scheduleShellMeasure(); requestAnimationFrame(attachControl); });
  }
  window.addEventListener("resize", () => { scheduleShellMeasure(); positionPanel(); }, { passive: true });
})();
