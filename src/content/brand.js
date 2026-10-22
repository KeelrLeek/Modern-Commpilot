/* The CommPilot logo in the top bar (Pulse, "Horizon tag", picked 2026-09-29) and what goes with it.
   The logo: the name, then a tag with the extension's version and the site (the host without its top-level domain:
   apps01.avpaas, apps-sbx.avpaas, phone.tripbx), and a heartbeat trace along the bar's bottom edge, in from the window's left, beating under "Pilot" and ending in
   a live dot under the tag's end. theme-palettes.css hides the site's own logo cell and its "CommPilot" text, so the
   bar is the same on every CommPilot site. The logo is the Home button (it presses CommPilot's own Home link).
   The trace is also the loading bar: while CommPilot works (pjax.js's --cp-progress and <html data-cp-progress>)
   a bright line runs along it from the left, and when the page lands it reaches the dot, which pings. When the
   logo first appears the trace sweeps in once. After an update the dot wears a ring until Settings (with About)
   is opened.
   Every colour is a palette token, so the logo follows any palette. The tab's icon is the theme's own icon
   (assets/icons/theme-<palette>.svg; on the sandbox theme-<palette>-sbx.svg, with an amber dot), installed by
   scripts/make-theme-marks.cjs, and the toolbar icon (src/bg/icon.js) is drawn from the colours sent from here. */
(() => {
  if (window !== window.top) return;
  const version = chrome.runtime.getManifest().version;
  const hostname = location.hostname.toLowerCase();
  const host = hostname.split(".")[0];
  const site = hostname.split(".").slice(0, -1).join(".") || hostname;   // apps01.avpaas.io → apps01.avpaas
  const env = host === "apps-sbx" ? "sandbox" : "live";
  const envName = env === "sandbox" ? "Sandbox" : "Live";
  const seenKey = "cpSeenVersion";
  let seen = null;

  // The Pulse tile (24 grid): the tab icon, the toolbar icon and the Settings window share this art.
  const TILE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cp-tile-ground" ' +
    'd="M-1 17.4H5.6l1.7-2.2 1.7 2.2h1.5l2.2-12 2.5 13.8 1.3-1.8H25V25H-1Z"/><path d="M-1 17.4H5.6l1.7-2.2 1.7 2.2h1.5l2.2-12 ' +
    '2.5 13.8 1.3-1.8H25" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  globalThis.cpBrand = { version, hostname, host, env, envName, tile: TILE, seenKey };

  // The trace, drawn 1:1 in px on y 23 of a 24px-tall svg whose bottom is the bar's bottom edge. It starts at the
  // window's left (the bar cell's 27px padding before the name) and its spike stands under "Pi"; it runs on to the
  // logo's right edge, where the dot is (fit() sets the end, so the loading line's 100% is the dot). The gradient
  // fades it in from the left.
  const PAD = 27;
  const edge = end => `M0 23H${PAD + 42.5}l2.4-2.8 2.4 2.8h4.2l2.9-16.8 2.9 17.8 1.2-1h9l4.2-4.2 4.2 4.2H${end}`;
  const EDGE = edge(400);
  const MARKUP = '<span class="cp-brand-name">CommPilot</span>' +
    '<span class="cp-brand-tag"><span class="cp-brand-meta"></span></span>' +
    `<svg class="cp-brand-edge" aria-hidden="true"><defs><linearGradient id="cp-brand-fade" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="0" x2="${PAD + 114}" y2="0"><stop offset="0" class="cp-brand-s0"/><stop offset=".45" class="cp-brand-s1"/>` +
    '<stop offset="1" class="cp-brand-s2"/></linearGradient></defs>' +
    `<path class="cp-brand-base" stroke="url(#cp-brand-fade)" d="${EDGE}"/>` +
    `<path class="cp-brand-trace" stroke="url(#cp-brand-fade)" pathLength="1" d="${EDGE}"/>` +
    `<path class="cp-brand-load" stroke="url(#cp-brand-fade)" pathLength="1" d="${EDGE}"/></svg>` +
    '<svg class="cp-brand-dot" viewBox="0 0 20 20" aria-hidden="true"><circle class="cp-brand-halo" cx="10" cy="10" r="5.4"/>' +
    '<circle class="cp-brand-ping" cx="10" cy="10" r="2.8"/><circle class="cp-brand-light" cx="10" cy="10" r="2.8"/></svg>';

  const headerCell = () => [...document.querySelectorAll("td.headerBar")]
    .find(cell => cell.querySelector("a.headerLink") && !cell.querySelector(".headerBarWelcome"));

  let observedBrand = null;
  function observeBrand(brand) {
    if (observedBrand === brand) return;
    if (observedBrand) fits.unobserve(observedBrand);
    observedBrand = brand;
    if (brand) fits.observe(brand);
  }
  function attach() {
    if (observedBrand && !observedBrand.isConnected) observeBrand(null);
    let brand = document.querySelector(".cp-brand");
    if (document.body?.id !== "initBody.menuTemplate") { observeBrand(null); brand?.remove(); return; }
    const header = headerCell();
    if (!header) return;
    if (brand?.parentElement !== header) {
      brand?.remove();
      brand = document.createElement("a");
      brand.className = "cp-brand";
      brand.dataset.env = env;
      brand.setAttribute("role", "link");
      brand.tabIndex = 0;
      brand.title = `Home · CommPilot Enhancer ${version}`;
      brand.setAttribute("aria-label", `CommPilot on ${hostname}. Home`);
      brand.innerHTML = MARKUP;
      brand.querySelector(".cp-brand-meta").textContent = `v${version} · ${site}`;
      brand.classList.add("cp-brand-intro");   // the first sweep, once (theme-palettes.css)
      setTimeout(() => brand.classList.remove("cp-brand-intro"), 2200);
      header.prepend(brand);
      observeBrand(brand);
      fit(brand);
    }
    brand.classList.toggle("cp-brand-new", seen !== null && seen !== version);
  }

  // The trace ends at the logo's right edge (the dot): its width changes with the fonts loading and, on a narrow
  // window, the tag's details folding away.
  function fit(brand) {
    const end = Math.round(brand.getBoundingClientRect().width) + PAD;
    if (end <= PAD || brand.dataset.end === String(end)) return;
    brand.dataset.end = end;
    for (const path of brand.querySelectorAll(".cp-brand-edge path")) path.setAttribute("d", edge(end));
  }
  const fits = new ResizeObserver(entries => { for (const entry of entries) fit(entry.target); });

  // The logo presses CommPilot's own Home link (its handler posts through pjax.js). CommPilot pages are POST-only,
  // so there is nothing to open in a new tab: modified clicks are left alone.
  function goHome() {
    const home = [...(headerCell()?.querySelectorAll("a.headerLink") || [])]
      .find(a => /\bhome\b/i.test(a.dataset.cpOriginalLabel || a.textContent || ""));
    home?.click();
  }
  document.addEventListener("click", event => {
    if (!event.target.closest?.(".cp-brand")) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goHome();
  });
  document.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest?.(".cp-brand")) {
      event.preventDefault();
      goHome();
    }
  });

  // The tab's icon: the theme's icon for the palette on <html> (theme-settings.js sets it on every CommPilot page,
  // Login included), with an amber dot on the sandbox.
  function setFavicon() {
    const palette = document.documentElement?.dataset.cpDirection;
    if (!palette || !document.head) return;
    const href = chrome.runtime.getURL(`assets/icons/theme-${palette}${env === "sandbox" ? "-sbx" : ""}.svg`);
    let link = document.getElementById("cp-favicon");
    if (!link) {
      link = document.createElement("link");
      link.id = "cp-favicon";
      link.rel = "icon";
      link.type = "image/svg+xml";
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    if (link.parentNode !== document.head) document.head.append(link);
  }

  // The toolbar icon and its SBX badge (src/bg/icon.js): the palette's own colours, read from the page, so a new
  // palette needs nothing here.
  function send(message) {
    try { chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError); } catch (_) {}   // reloaded extension
  }
  let sentColors = "";
  function sendColors() {
    if (document.body?.id !== "initBody.menuTemplate") return;
    const style = getComputedStyle(document.body);
    const colors = { tile: style.getPropertyValue("--d-action").trim(), ink: style.getPropertyValue("--d-action-text").trim(),
      accent: style.getPropertyValue("--d-accent").trim() };
    if (!colors.tile || !colors.ink || !colors.accent) return;
    const key = JSON.stringify(colors);
    if (key === sentColors) return;
    sentColors = key;
    send({ kind: "cpPalette", palette: document.documentElement.dataset.cpDirection, colors });
  }

  function start() {
    attach();
    setFavicon();
    sendColors();
    send({ kind: "cpEnv", env });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  addEventListener("load", sendColors, { once: true });   // in case the palette's stylesheet arrived after the DOM
  for (const eventName of ["cp:morphed", "cp:reskin"]) document.addEventListener(eventName, () => requestAnimationFrame(attach));
  document.addEventListener("cp:theme-change", () => { setFavicon(); requestAnimationFrame(sendColors); });

  chrome.storage.local.get(seenKey, values => { seen = values?.[seenKey] || ""; attach(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, seenKey)) { seen = changes[seenKey].newValue || ""; attach(); }
  });
})();
