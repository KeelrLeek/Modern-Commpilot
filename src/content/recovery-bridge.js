// Keep PJAX recovery state per host. This script runs in the extension's isolated world.
(function () {
  if (window !== window.top) return;

  const key = name => name + ":" + location.origin;
  // An extension reload can invalidate this isolated world's storage API while the native page is still
  // open. Recovery persistence is best effort; failed storage must not throw out of navigation listeners.
  function store(data, done) {
    try {
      chrome.storage.local.set(data, () => { const error = chrome.runtime.lastError; if (done) done(error); });
    } catch (error) { if (done) done(error); }
  }
  function reply(data) {
    try {
      window.postMessage({ __cpStubNavReply: {
        nav: recoveryNav(data && data[key("cpRecoverNav")]),
        token: data && data[key("cpRecoverToken")] || null
      } }, location.origin);
    } catch (_) {}
  }
  // Apply the replay boundary before persistence too: a native form can submit without a named
  // OK/Apply button. Recovery must never retain its credentials or actionable form fields.
  function recoveryNav(value, isEntry = false) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.url !== 'string') return null;
      const url = new URL(value.url, location.href);
      if (url.origin !== location.origin || url.username || url.password || !url.pathname.startsWith('/commpilot/') ||
          /\/(?:Login|Logout|servlet|Add|AddRange|AddModify|Import|Delete)(?:\/|$)/i.test(decodeURIComponent(url.pathname))) return null;
      const source = value.params || {}, params = Object.create(null);
      if (typeof source !== 'object' || Array.isArray(source)) return null;
      const mutation = (name, val) => /^(?:ok|apply|delete|cancel|save|submit|__cpFormEntries)$/i.test(name) ||
        /password|secret|passcode|^pin$/i.test(name) || /^buttonClicked$/i.test(name) && String(val || '').trim() !== '';
      for (const [name, val] of [...url.searchParams.entries()]) {
        if (mutation(name, val)) return null;
        if (/^formtokenserial$/i.test(name)) url.searchParams.delete(name);
      }
      for (const name of Object.keys(source)) {
        if (mutation(name, source[name]) || source[name] !== null && typeof source[name] === 'object') return null;
        if (/^(?:formtokenserial|__proto__|constructor|prototype)$/i.test(name)) continue;
        params[name] = source[name];
      }
      const entry = !isEntry && value.entry ? recoveryNav(value.entry, true) : null;
      if (!isEntry && value.entry && !entry) return null;
      return {url: url.pathname + url.search, params, entry};
    } catch (_) { return null; }
  }

  let savedToken = null, writingToken = null, desiredToken = null;
  function writeToken() {
    const token = desiredToken;
    writingToken = token;
    store({ [key('cpRecoverToken')]: token }, error => {
      writingToken = null;
      if (!error) savedToken = token;
      if (desiredToken !== token) writeToken();
    });
  }
  function saveToken() {
    if (location.pathname.includes("/Login/") || location.pathname.includes("/Logout/")) return;
    if (!document.querySelector('td[width="82%"]')) return;
    const input = document.querySelector('[name="formtokenserial"]');
    if (!input || !input.value) return;
    try { sessionStorage.setItem("cp-stub-tries", "0"); } catch (_) {}
    // A second tab may have a newer token in the host store. Repeated skin/morph notifications from
    // this unchanged page must not replace it. Coalesce notifications while the current save completes.
    desiredToken = input.value;
    if (writingToken === null && desiredToken !== savedToken) writeToken();
  }

  function receive(event) {
    if (event.source !== window || event.origin !== location.origin || !event.data) return;
    if (event.data.__cpRecoverNav) {
      const nav = recoveryNav(event.data.__cpRecoverNav);
      if (!nav) return;
      store({ [key("cpRecoverNav")]: nav });
    }
    if (event.data.__cpStubNavQuery) {
      try {
        chrome.storage.local.get([key("cpRecoverNav"), key("cpRecoverToken")], data => {
          reply(chrome.runtime.lastError ? null : data);
        });
      } catch (_) { reply(null); }
    }
  }

  window.addEventListener("message", receive);
  document.addEventListener("cp:reskin", saveToken);
  document.addEventListener("cp:morphed", saveToken);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", saveToken, { once: true });
  else saveToken();
})();
