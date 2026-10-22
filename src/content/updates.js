/* Updates inside CommPilot Settings. Remote notes are text, never page HTML or executable code. */
(() => {
  "use strict";
  if (window.frameElement?.hasAttribute("data-cp-transport")) return;   // pjax.js's hidden transport frames
  const markup = () => `<section class="cp-settings-section cp-updates" aria-label="Updates">
    <div class="cp-theme-head"><h3>Updates</h3>
      <div class="cp-theme-mode" role="radiogroup" aria-label="Update channel">
        <label><input type="radio" name="cp-update-channel" value="stable" checked>Stable</label>
        <label><input type="radio" name="cp-update-channel" value="nightly">Nightly</label>
      </div>
    </div>
    <p class="cp-settings-lede cp-update-channel-note">Stable releases are tested and approved. Nightly builds contain development changes.</p>
    <label class="cp-settings-row"><span class="cp-settings-text"><strong>Automatic update checks</strong>
      <span>Check GitHub daily and when the browser starts. Downloads stay manual.</span></span>
      <input type="checkbox" class="cp-settings-switch" name="cp-update-automatic" role="switch" checked>
    </label>
    <div class="cp-settings-text cp-update-summary" role="status" aria-live="polite">
      <strong class="cp-update-status">Loading update settings…</strong><span class="cp-update-versions"></span>
      <span class="cp-update-checked"></span>
    </div>
    <div class="cp-update-actions">
      <button type="button" class="cp-update-button cp-update-check">Check for updates</button>
      <a class="cp-update-button cp-update-download" target="_blank" rel="noopener noreferrer" hidden>Download update</a>
      <a class="cp-update-release" target="_blank" rel="noopener noreferrer" hidden>View on GitHub</a>
    </div>
    <details class="cp-update-notes" hidden><summary>Release notes</summary><div></div></details>
    <details class="cp-update-help"><summary>How to install an update</summary>
      <ol><li>Download and extract the ZIP into your existing extension folder.</li>
      <li>Open your browser’s extensions page and reload CommPilot Enhancer.</li>
      <li>Refresh CommPilot after finishing any unsaved work.</li></ol>
      <p>Unpacked installs cannot replace their own files. Checking for updates does not reload your page.</p>
    </details>
  </section>`;
  let current;
  function mount(panel) {
    const section = panel.querySelector(".cp-updates");
    if (!section || section.dataset.mounted) return;
    section.dataset.mounted = "true";
    const find = selector => section.querySelector(selector);
    let sequence = 0;
    function render(state) {
      const prefs = state.preferences, cache = state.cache, release = cache?.release;
      for (const radio of section.querySelectorAll('[name="cp-update-channel"]')) radio.checked = radio.value === prefs.channel;
      find('[name="cp-update-automatic"]').checked = prefs.automatic;
      const channel = prefs.channel === "nightly" ? "Nightly" : "Stable";
      let status = "Ready to check for updates.";
      if (cache?.error) status = cache.error;
      else if (cache?.checkedAt && !release) status = `No ${channel.toLowerCase()} release has been published yet.`;
      else if (state.available) status = `${channel} update available: ${release.version}`;
      else if (state.newerInstalled) status = `Your installed build is newer than the ${channel.toLowerCase()} release.`;
      else if (release) status = `You’re up to date on ${channel}.`;
      find(".cp-update-status").textContent = status;
      find(".cp-update-versions").textContent = `Installed ${state.installed}` +
        (release ? ` · ${channel} ${release.version}` : ` · ${channel} channel`);
      find(".cp-update-checked").textContent = cache?.checkedAt
        ? `Last successful check: ${new Date(cache.checkedAt).toLocaleString()}`
        : "No successful check yet.";
      const download = find(".cp-update-download");
      download.hidden = !state.available;
      if (state.available) download.href = release.url; else download.removeAttribute("href");
      const link = find(".cp-update-release");
      link.hidden = !release;
      if (release) link.href = release.notesUrl; else link.removeAttribute("href");
      const notes = find(".cp-update-notes");
      notes.hidden = !release?.notes;
      notes.querySelector("div").textContent = (release?.notes || "")
        .replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
      section.dataset.channel = prefs.channel;
    }
    async function load(op = "state", patch) {
      const ticket = ++sequence;
      const button = find(".cp-update-check");
      button.disabled = true;
      button.textContent = "Checking…";
      section.setAttribute("aria-busy", "true");
      // Never leave a previous channel's download available while a new check is pending.
      find(".cp-update-download").hidden = true;
      find(".cp-update-download").removeAttribute("href");
      find(".cp-update-release").hidden = true;
      find(".cp-update-notes").hidden = true;
      find(".cp-update-status").textContent = "Checking update information…";
      try {
        const state = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({kind: "cpUpdates", op, ...(patch ? {patch} : {})}, result => {
            if (chrome.runtime.lastError || !result) reject(Error("Reload the extension and refresh CommPilot to use updates."));
            else resolve(result);
          });
        });
        if (ticket !== sequence || !section.isConnected) return;
        if (!state.ok) throw Error(state.error);
        render(state);
      } catch (error) {
        if (ticket === sequence) find(".cp-update-status").textContent = error.message || "Could not check for updates.";
      } finally {
        if (ticket === sequence) {
          button.disabled = false;
          button.textContent = "Check for updates";
          section.setAttribute("aria-busy", "false");
        }
      }
    }
    section.addEventListener("change", event => {
      if (event.target.name === "cp-update-channel") load("preferences", {channel: event.target.value});
      if (event.target.name === "cp-update-automatic") load("preferences", {automatic: event.target.checked});
    });
    find(".cp-update-check").addEventListener("click", () => load("check"));
    find(".cp-update-download").addEventListener("click", () => { find(".cp-update-help").open = true; });
    current = {section, load};
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !current?.section.isConnected || current.section.closest("[hidden]")) return;
    const channel = current.section.querySelector('[name="cp-update-channel"]:checked')?.value;
    const cacheKey = channel === "nightly" ? "cpUpdateNightly" : "cpUpdateStable";
    // A background result for the other channel must not clear the visible
    // channel's download or supersede its pending response.
    if (Object.hasOwn(changes, "cpUpdatePreferences") || Object.hasOwn(changes, cacheKey)) current.load();
  });
  globalThis.cpUpdatesUI = {markup, mount, refresh: () => current?.load()};
})();
