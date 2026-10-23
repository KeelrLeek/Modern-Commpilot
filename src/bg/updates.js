/* Public release metadata only. This worker never installs code or sends CommPilot data to GitHub. */
(() => {
  "use strict";
  const repository = "KeelrLeek/Modern-Commpilot";
  const api = `https://api.github.com/repos/${repository}/releases/`;
  const releases = `https://github.com/${repository}/releases`;
  const preferencesKey = "cpUpdatePreferences";
  const alarmName = "cp-update-check";
  const day = 24 * 60 * 60 * 1000;
  const sites = new Set(["apps.avpaas.io", "apps01.avpaas.io", "apps02.avpaas.io",
    "apps-sbx.avpaas.io", "phone.tripbx.com", "phone1.tripbx.com", "phone2.tripbx.com"]);
  const pending = new Map();
  let preferenceQueue = Promise.resolve();
  const cacheKey = channel => channel === "nightly" ? "cpUpdateNightly" : "cpUpdateStable";
  const get = key => new Promise((resolve, reject) => chrome.storage.local.get(key, values =>
    chrome.runtime.lastError ? reject(Error("Could not read update settings.")) : resolve(values?.[key])));
  const set = (key, value) => new Promise((resolve, reject) => chrome.storage.local.set({[key]: value}, () =>
    chrome.runtime.lastError ? reject(Error("Could not save update settings.")) : resolve()));
  const preferences = async () => {
    const value = await get(preferencesKey);
    return {channel: value?.channel === "nightly" ? "nightly" : "stable", automatic: value?.automatic !== false};
  };
  function versionParts(value) {
    if (typeof value !== "string" || !/^\d{1,5}(?:\.\d{1,5}){2,3}$/.test(value)) return null;
    const parts = value.split(".").map(Number);
    return parts.every(n => n <= 65535) ? [...parts, ...Array(4 - parts.length).fill(0)] : null;
  }
  function compare(left, right) {
    const a = versionParts(left), b = versionParts(right);
    if (!a || !b) return null;
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
  }
  function parseRelease(data, channel) {
    if (!data || data.draft !== false || !Array.isArray(data.assets) || !Date.parse(data.published_at)) {
      throw Error("GitHub returned incomplete release information.");
    }
    const tag = data.tag_name;
    const tagVersion = typeof tag === "string" && /^v(\d+\.\d+\.\d+(?:\.\d+)?)(?:-pjax-preview)?$/.exec(tag)?.[1];
    if (channel === "stable" ? data.prerelease !== false || !tagVersion :
      data.prerelease !== true || tag !== "nightly") {
      throw Error("GitHub returned a release from the wrong update channel.");
    }
    const candidates = data.assets.filter(asset =>
      /^BroadWorks-Enhancer-PJAX-Preview-\d+\.\d+\.\d+(?:\.\d+)?(?:-nightly)?\.zip$/.test(asset.name || ""));
    if (candidates.length !== 1) throw Error("This release does not have one ready-to-download extension ZIP.");
    const asset = candidates[0];
    const version = /^BroadWorks-Enhancer-PJAX-Preview-(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(asset.name)[1];
    const url = `${releases}/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
    if (!versionParts(version) || channel === "stable" && compare(version, tagVersion) !== 0 ||
        asset.state !== "uploaded" || !(asset.size > 0) || asset.browser_download_url !== url ||
        data.html_url !== `${releases}/tag/${encodeURIComponent(tag)}`) {
      throw Error("The release ZIP does not match its published version or location.");
    }
    return {version, url, notesUrl: data.html_url, publishedAt: data.published_at,
      notes: typeof data.body === "string" ? data.body.slice(0, 20000) : ""};
  }
  async function fetchRelease(channel, previous) {
    const attemptedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let retryAt = attemptedAt + 15 * 60 * 1000, limited = false;
    try {
      const response = await fetch(api + (channel === "stable" ? "latest" : "tags/nightly"), {
        method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store",
        headers: {Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
        signal: controller.signal
      });
      if (response.status === 404) return {checkedAt: Date.now(), attemptedAt, release: null, error: ""};
      if (response.status === 403 || response.status === 429) {
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const retry = Number(response.headers.get("retry-after")) * 1000 + attemptedAt;
        retryAt = Math.max(retryAt, Math.min(Math.max(reset || 0, retry || 0), attemptedAt + day));
        limited = true;
        throw Error("GitHub is limiting update checks. Try again later.");
      }
      if (!response.ok) throw Error("GitHub could not check for updates. Try again later.");
      const text = await response.text();
      if (text.length > 500000) throw Error("GitHub returned an oversized update response.");
      let data;
      try { data = JSON.parse(text); } catch (_) { throw Error("GitHub returned invalid release information."); }
      return {checkedAt: Date.now(), attemptedAt, release: parseRelease(data, channel), error: ""};
    } catch (error) {
      const known = /^(GitHub|This release|The release ZIP)/.test(error.message || "");
      return {checkedAt: previous?.checkedAt || 0, attemptedAt, release: previous?.release || null, retryAt, limited,
        error: known ? error.message : "Could not reach GitHub. Check your connection and try again."};
    } finally { clearTimeout(timeout); }
  }
  function check(channel, force = false) {
    if (pending.has(channel)) return pending.get(channel);
    const work = (async () => {
      const previous = await get(cacheKey(channel));
      const now = Date.now();
      // A failure holds off automatic checks; a manual check waits only while GitHub is limiting checks.
      if (previous && ((previous.retryAt > now && (!force || previous.limited)) ||
          now - previous.attemptedAt < (force ? 30000 : previous.error ? 0 : day))) return previous;
      const result = await fetchRelease(channel, previous);
      await set(cacheKey(channel), result);
      return result;
    })().finally(() => pending.delete(channel));
    pending.set(channel, work);
    return work;
  }
  async function readState(force = false) {
    const prefs = await preferences();
    const cache = force || prefs.automatic ? await check(prefs.channel, force) : await get(cacheKey(prefs.channel));
    const installed = chrome.runtime.getManifest().version;
    // A failed check keeps the last successful release, so an update found earlier stays downloadable beside the error.
    const relation = cache?.release ? compare(cache.release.version, installed) : null;
    return {ok: true, preferences: prefs, installed, cache: cache || null,
      available: relation === 1, newerInstalled: relation === -1, releasesUrl: releases};
  }
  async function configureAlarm() {
    if (!chrome.alarms) return;
    const prefs = await preferences();
    if (!prefs.automatic) { await chrome.alarms.clear(alarmName); return; }
    const alarm = await chrome.alarms.get(alarmName);
    if (!alarm) await chrome.alarms.create(alarmName, {delayInMinutes: 1, periodInMinutes: 24 * 60});
  }
  async function automaticCheck() {
    await configureAlarm();
    const prefs = await preferences();
    if (prefs.automatic) await check(prefs.channel);
  }
  function allowed(sender) {
    try {
      const url = new URL(sender.url);
      return sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0 &&
        url.protocol === "https:" && !url.port && sites.has(url.hostname) && url.pathname.startsWith("/commpilot/");
    } catch (_) { return false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.kind !== "cpUpdates") return false;
    if (!allowed(sender) || !["state", "check", "preferences"].includes(message.op)) {
      reply({ok: false, error: "This page cannot request extension updates."});
      return false;
    }
    let work;
    if (message.op === "preferences") {
      const patch = message.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
          Object.keys(patch).some(key => !["channel", "automatic"].includes(key)) ||
          ("channel" in patch && !["stable", "nightly"].includes(patch.channel)) ||
          ("automatic" in patch && typeof patch.automatic !== "boolean")) {
        reply({ok: false, error: "Choose a valid update channel and check setting."});
        return false;
      }
      const save = async () => { await set(preferencesKey, {...await preferences(), ...patch}); await configureAlarm(); };
      preferenceQueue = preferenceQueue.then(save, save);
      work = preferenceQueue.then(() => readState());
    } else work = readState(message.op === "check");
    work.then(reply, () => reply({ok: false, error: "Could not load update settings. Reload the extension and refresh CommPilot."}));
    return true;
  });
  chrome.alarms?.onAlarm.addListener(alarm => {
    if (alarm.name === alarmName) automaticCheck().catch(() => {});
  });
  chrome.runtime.onStartup?.addListener(() => automaticCheck().catch(() => {}));
  chrome.runtime.onInstalled?.addListener(() => automaticCheck().catch(() => {}));
  // Recreate an alarm lost across a browser restart without fetching on each worker wake.
  configureAlarm().catch(() => {});
})();
