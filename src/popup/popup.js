(() => {
  "use strict";

  // The toolbar popup: the same twelve themes as Settings (themes.js), each light or dark, saved as the palette
  // ("cpThemePalette") every CommPilot tab follows. The popup wears the chosen palette's colours too.
  const storageKey = "cpThemePalette";
  const themes = globalThis.cpThemes;
  const themeOf = globalThis.cpThemeOf;
  const fallback = globalThis.cpThemeDefault;
  const status = document.getElementById("save-status");
  const footer = status.closest(".settings-footer");
  const grid = document.getElementById("palette-grid");
  let savedPalette = fallback;
  let selectedPalette = fallback;
  let writingPalette = null;
  let selectionChanged = false;
  let preferenceUpdated = false;

  for (const theme of themes) {
    const option = document.createElement("div");
    option.className = "theme-option";
    option.innerHTML = `<input type="radio" id="palette-${theme.id}" name="palette" value="${theme.id}">` +
      `<label for="palette-${theme.id}"><span class="tile" aria-hidden="true"><img alt=""></span>` +
      `<span class="option-name"></span><span class="option-check" aria-hidden="true">✓</span></label>`;
    option.querySelector(".option-name").textContent = theme.name;
    option.querySelector(".tile").dataset.theme = theme.id;
    grid.append(option);
  }
  const options = [...grid.querySelectorAll('input[name="palette"]')];
  const modes = [...document.querySelectorAll('input[name="mode"]')];

  const normalize = value => themeOf(value)?.palette || fallback;
  const label = palette => { const t = themeOf(palette); return `${t.theme.name}, ${t.mode}`; };

  function showSelection(value) {
    const chosen = themeOf(normalize(value));
    document.documentElement.dataset.cpPalette = chosen.palette;
    for (const input of options) input.checked = input.value === chosen.theme.id;
    for (const input of modes) input.checked = input.value === chosen.mode;
    // Each tile shows its theme on the side the switch is on.
    for (const tile of grid.querySelectorAll(".tile")) {
      const palette = themes.find(t => t.id === tile.dataset.theme)[chosen.mode];
      tile.dataset.cpPalette = palette;
      tile.querySelector("img").src = `../../assets/icons/theme-${palette}.svg`;
    }
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    footer.classList.toggle("error", error);
  }

  function save(palette) {
    selectionChanged = true;
    selectedPalette = normalize(palette);
    showSelection(selectedPalette);
    setStatus("Saving…");
    if (writingPalette === null) writeSelection();
  }

  // Keep the visible choice separate from the last acknowledged save. Serialize writes so a slower old
  // selection cannot overwrite a newer one; changes made while saving are coalesced to the latest choice.
  function writeSelection() {
    const palette = selectedPalette;
    writingPalette = palette;
    const complete = error => {
      writingPalette = null;
      if (!error) {
        savedPalette = palette;
        preferenceUpdated = true;
      }
      if (selectedPalette !== palette) {
        writeSelection();
        return;
      }
      if (error) {
        selectedPalette = savedPalette;
        showSelection(selectedPalette);
        setStatus("Could not save. Try another theme.", true);
        return;
      }
      setStatus(`${label(palette)} is active in CommPilot.`);
    };
    try {
      chrome.storage.local.set({ [storageKey]: palette }, () => complete(chrome.runtime.lastError));
    } catch (error) { complete(error); }
  }

  showSelection(selectedPalette);
  try {
    chrome.storage.local.get(storageKey, (result) => {
      if (preferenceUpdated) return;
      if (chrome.runtime.lastError) {
        if (!selectionChanged) setStatus("Could not load your preference.", true);
        return;
      }
      savedPalette = normalize(result?.[storageKey]);
      if (!selectionChanged) {
        selectedPalette = savedPalette;
        showSelection(selectedPalette);
        setStatus("Your theme is saved automatically.");
      }
    });
  } catch (_) { setStatus("Could not load your preference.", true); }

  // A theme keeps the side the switch is on; the switch keeps the theme and changes its side.
  grid.addEventListener("change", (event) => {
    const theme = themes.find(t => t.id === event.target.value);
    if (theme) save(theme[themeOf(selectedPalette).mode]);
  });
  for (const input of modes) input.addEventListener("change", () => save(themeOf(selectedPalette).theme[input.value]));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, storageKey)) return;
    const chosen = normalize(changes[storageKey].newValue);
    savedPalette = chosen;
    preferenceUpdated = true;
    if (writingPalette !== null) return;
    selectedPalette = chosen;
    showSelection(chosen);
    setStatus(`${label(chosen)} is active in CommPilot.`);
  });
})();
