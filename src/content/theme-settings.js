/* Keep the selected CommPilot palette in sync across tabs and PJAX views. */
(() => {
  const key = "cpThemePalette";
  const choices = new Set(["midnight", "atlas", "graphite", "terra"]);
  const root = document.documentElement;
  let shellFrame = 0;

  function apply(value) {
    const palette = choices.has(value) ? value : "midnight";
    if (palette === "midnight") delete root.dataset.cpDirection;
    else root.dataset.cpDirection = palette;
    document.dispatchEvent(new CustomEvent("cp:theme-change", { detail: { palette } }));
    scheduleShellMeasure();
  }

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
    document.addEventListener("DOMContentLoaded", scheduleShellMeasure, { once: true });
  } else scheduleShellMeasure();
  document.addEventListener("cp:morphed", scheduleShellMeasure);
  document.addEventListener("cp:reskin", scheduleShellMeasure);
  window.addEventListener("resize", scheduleShellMeasure, { passive: true });
})();
