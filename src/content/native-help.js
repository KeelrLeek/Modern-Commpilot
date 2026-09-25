(() => {
  "use strict";

  if (!location.pathname.startsWith("/commpilot/")) return;
  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  if (!runtime?.getURL) return;

  let entries;
  let active = false;
  let tip;
  let hoverTimer;
  let hovered;

  function hideTip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
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
    tip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const body = document.createElement("span");
    body.textContent = entry.body;
    tip.append(title, body);
    tip.hidden = false;
    const bounds = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - bounds.width - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(y + 14, innerHeight - bounds.height - 8)) + "px";
  }

  function entryFor(link) {
    const name = link.getAttribute("name");
    if (name && entries.byName?.[name]) return entries.byName[name];
    if (link.matches("a.leftnavfolder, a.leftnavfolderopen")) {
      return entries.byText?.[link.textContent.trim()] || null;
    }
    return null;
  }

  function setActive(value) {
    active = value;
    document.body.classList.toggle("cp-native-help-active", active);
    const button = document.getElementById("cp-native-help-toggle");
    if (button) button.setAttribute("aria-pressed", String(active));
    if (!active) hideTip();
  }

  function attachButton() {
    if (!entries || !document.body) return;
    const levels = [...document.querySelectorAll('td.headerBar a.headerAuthLevelLink')]
      .map(link => link.textContent.trim());
    if (levels.length !== 1 || levels[0] !== "Reseller") {
      document.getElementById("cp-native-help-toggle")?.remove();
      setActive(false);
      return;
    }
    const form = document.querySelector('form[name="leftNavForm"]');
    if (!form || !form.parentNode) return;
    let button = document.getElementById("cp-native-help-toggle");
    if (button && button.previousElementSibling === form) return;
    if (button) button.remove();
    button = document.createElement("button");
    button.id = "cp-native-help-toggle";
    button.type = "button";
    button.textContent = "Help tips";
    button.title = "Show explanations when you hover over menu items";
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => setActive(!active));
    form.after(button);
  }

  document.addEventListener("mouseover", event => {
    if (!active || !entries || !event.target.closest) return;
    const link = event.target.closest("a.navMenuItem[name], a.leftnavfolder, a.leftnavfolderopen");
    if (!link || link === hovered) return;
    hideTip();
    const entry = entryFor(link);
    if (!entry) return;
    hovered = link;
    const x = event.clientX;
    const y = event.clientY;
    hoverTimer = setTimeout(() => {
      if (active && hovered === link) showTip(entry, x, y);
    }, 120);
  }, true);

  document.addEventListener("mouseout", event => {
    if (!active || !hovered || !hovered.contains(event.target)) return;
    if (event.relatedTarget && hovered.contains(event.relatedTarget)) return;
    hideTip();
  }, true);

  document.addEventListener("keydown", event => {
    if (active && event.key === "Escape") setActive(false);
  }, true);

  document.addEventListener("cp:reskin", () => { hideTip(); setTimeout(attachButton, 0); });
  document.addEventListener("cp:morphed", () => { hideTip(); setTimeout(attachButton, 0); });

  fetch(runtime.getURL("assets/help/help-content.json"))
    .then(response => {
      if (!response.ok) throw new Error("Help content HTTP " + response.status);
      return response.json();
    })
    .then(data => { entries = data; attachButton(); })
    .catch(error => console.warn("[native help] unavailable:", error));
})();
