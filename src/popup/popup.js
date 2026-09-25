(() => {
  "use strict";

  const storageKey = "cpThemePalette";
  const palettes = new Set(["nord", "atlas", "graphite", "terra"]);
  const status = document.getElementById("save-status");
  const footer = status.closest(".settings-footer");
  const options = [...document.querySelectorAll('input[name="palette"]')];
  let savedPalette = "atlas";
  let selectionChanged = false;

  function normalize(value) {
    if (value === "midnight") return "nord";
    return palettes.has(value) ? value : "atlas";
  }

  function showSelection(value) {
    const chosen = normalize(value);
    document.documentElement.dataset.theme = chosen;
    const option = options.find((input) => input.value === chosen);
    if (option) option.checked = true;
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    footer.classList.toggle("error", error);
  }

  chrome.storage.local.get(storageKey, (result) => {
    if (chrome.runtime.lastError) {
      setStatus("Could not load your preference.", true);
      return;
    }
    savedPalette = normalize(result?.[storageKey]);
    if (!selectionChanged) showSelection(savedPalette);
    setStatus("Your palette is saved automatically.");
  });

  document.getElementById("palette-grid").addEventListener("change", (event) => {
    const option = event.target;
    if (!(option instanceof HTMLInputElement) || !palettes.has(option.value)) return;
    selectionChanged = true;
    showSelection(option.value);
    setStatus("Saving…");
    chrome.storage.local.set({ [storageKey]: option.value }, () => {
      if (chrome.runtime.lastError) {
        showSelection(savedPalette);
        setStatus("Could not save. Try another palette.", true);
        return;
      }
      savedPalette = option.value;
      setStatus(`${option.value[0].toUpperCase()}${option.value.slice(1)} is active in CommPilot.`);
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, storageKey)) return;
    const chosen = normalize(changes[storageKey].newValue);
    savedPalette = chosen;
    showSelection(chosen);
    setStatus(`${chosen[0].toUpperCase()}${chosen.slice(1)} is active in CommPilot.`);
  });
})();
