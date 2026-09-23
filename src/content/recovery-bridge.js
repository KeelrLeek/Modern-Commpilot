// Keep PJAX recovery state per host. This script runs in the extension's isolated world.
(function () {
  if (window !== window.top) return;

  const key = name => name + ":" + location.origin;
  const sameOriginPath = value => {
    try {
      const url = new URL(String(value), location.href);
      return url.origin === location.origin && url.pathname.startsWith("/commpilot/")
        ? url.pathname + url.search : null;
    } catch (_) { return null; }
  };

  function saveToken() {
    if (location.pathname.includes("/Login/") || location.pathname.includes("/Logout/")) return;
    if (!document.querySelector('td[width="82%"]')) return;
    const input = document.querySelector('[name="formtokenserial"]');
    if (!input || !input.value) return;
    chrome.storage.local.set({ [key("cpRecoverToken")]: input.value });
    try { sessionStorage.setItem("cp-stub-tries", "0"); } catch (_) {}
  }

  function receive(event) {
    if (event.source !== window || event.origin !== location.origin || !event.data) return;
    if (event.data.__cpRecoverNav) {
      const incoming = event.data.__cpRecoverNav;
      const path = sameOriginPath(incoming.url);
      if (!path) return;
      const entryPath = incoming.entry && sameOriginPath(incoming.entry.url);
      const nav = {
        url: path,
        params: incoming.params || {},
        entry: entryPath ? { url: entryPath, params: incoming.entry.params || {} } : null
      };
      chrome.storage.local.set({ [key("cpRecoverNav")]: nav });
    }
    if (event.data.__cpStubNavQuery) {
      chrome.storage.local.get([key("cpRecoverNav"), key("cpRecoverToken")], data => {
        window.postMessage({ __cpStubNavReply: {
          nav: data[key("cpRecoverNav")] || null,
          token: data[key("cpRecoverToken")] || null
        } }, location.origin);
      });
    }
  }

  window.addEventListener("message", receive);
  document.addEventListener("cp:reskin", saveToken);
  document.addEventListener("cp:morphed", saveToken);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", saveToken, { once: true });
  else saveToken();
})();
