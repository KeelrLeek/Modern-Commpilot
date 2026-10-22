/* Add icon hints to CommPilot's existing navigation without moving its links. */
(() => {
  const iconByFolder = {
    profile: "profile",
    resources: "resources",
    services: "services",
    "call center": "callcenter",
    "incoming calls": "incoming-calls",
    "outgoing calls": "outgoing-calls",
    "call control": "call-control",
    "calling plan": "calling-plan",
    "calling plans": "calling-plan",
    messaging: "messaging",
    utilities: "utilities",
    "meet-me conferencing": "meetme",
    "client applications": "client-apps",
    "communication barring": "comm-barring",
    menus: "services",
    "routing policies": "call-control"
  };

  // The menu board's section headers and each page's header show the same icon as their folder in the sidebar.
  // pjax.js (board) and forms.js (page) mark them with the folder's name; this sheet turns the name into the icon.
  const iconUrl = icon => `url("${chrome.runtime.getURL(`assets/icons/palette-${icon}.svg`)}")`;
  const boardIcons = document.createElement("style");
  boardIcons.id = "cp-board-icons";
  boardIcons.textContent = [`:is(.cp-console-head-ico, .cp-frame-ico) { --cp-head-icon: ${iconUrl("unknown")}; }`,
    ...Object.entries(iconByFolder).map(([name, icon]) =>
      `:is(.cp-console-head-ico, .cp-frame-ico)[data-cp-name="${name}"] { --cp-head-icon: ${iconUrl(icon)}; }`)].join("\n");
  (document.head || document.documentElement).appendChild(boardIcons);

  function decorate() {
    if (document.body?.id !== "initBody.menuTemplate") return;
    const links = document.querySelectorAll(
      'form[name="leftNavForm"] a.leftnavfolder, ' +
      'form[name="leftNavForm"] a.leftnavfolderopen'
    );
    for (const link of links) {
      const label = link.textContent.trim().replace(/\s+/g, " ").toLowerCase();
      const icon = iconByFolder[label] || "unknown";
      link.dataset.cpNavIcon = icon;
      // PJAX can retain the data attribute while replacing the inline style.
      // Reapply the URL on every morph so icon hints survive navigation.
      const url = `url("${chrome.runtime.getURL(`assets/icons/${icon}.svg`)}")`;
      if (link.style.getPropertyValue("--cp-nav-icon") !== url) {
        link.style.setProperty("--cp-nav-icon", url);
      }
    }
    document.dispatchEvent(new Event("cp:navigation-decorated"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", decorate, { once: true });
  } else decorate();
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; decorate(); });
  }
  document.addEventListener("cp:reskin", schedule);
  document.addEventListener("cp:morphed", schedule);
})();
