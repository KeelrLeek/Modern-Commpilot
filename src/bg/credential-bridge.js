// Chrome runs this file as the service worker; Firefox's event page lists icon.js itself.
if (typeof importScripts === "function") importScripts("/src/bg/icon.js", "/src/bg/updates.js");

// Saved passwords are AES-GCM ciphertext in extension storage. A non-extractable
// Web Crypto key is kept in the extension's IndexedDB so automatic sign-in can
// work after a browser restart without an external program or vault password.
(function () {
  "use strict";
  var SITES = new Set([
    "apps.avpaas.io", "apps01.avpaas.io", "apps02.avpaas.io",
    "apps-sbx.avpaas.io", "phone.tripbx.com", "phone1.tripbx.com",
    "phone2.tripbx.com"
  ]);
  var VAULT = "bwEncryptedVaultV2";
  var OLD_VAULT = "bwEncryptedVaultV1";
  var DATABASE = "bwCredentialKeysV1";
  var AAD = new TextEncoder().encode(VAULT);
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var mutationQueue = Promise.resolve();
  var keyPromise;

  function encoded(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 8192)
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
    return btoa(parts.join(""));
  }
  function decoded(value) {
    var raw = atob(value), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function randomBytes(count) { return crypto.getRandomValues(new Uint8Array(count)); }
  function randomId() {
    return Array.from(randomBytes(16), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function storeGet(key) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(key, function (values) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(values ? values[key] : undefined);
      });
    });
  }
  function storeSet(key, value) {
    return new Promise(function (resolve, reject) {
      var values = {}; values[key] = value;
      chrome.storage.local.set(values, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }
  function storeRemove(key) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.remove(key, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = function () { request.result.createObjectStore("keys"); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }
  function dbRead(db) {
    return new Promise(function (resolve, reject) {
      var request = db.transaction("keys", "readonly").objectStore("keys").get("main");
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
  }
  function dbWrite(db, key) {
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction("keys", "readwrite");
      transaction.objectStore("keys").put(key, "main");
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error); };
      // An explicit cancellation can fire abort without an error event. Reject so getKey releases its
      // cached promise and the mutation queue can accept a later retry instead of hanging every save.
      transaction.onabort = function () { reject(transaction.error || new Error('Encryption key transaction was cancelled.')); };
    });
  }
  function getKey(create) {
    if (!keyPromise) {
      keyPromise = (async function () {
        var db = await openDatabase();
        try {
          var key = await dbRead(db);
          if (!key && create) {
            key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
            await dbWrite(db, key);
          }
          return key;
        } finally { db.close(); }
      })().catch(function (error) { keyPromise = null; throw error; });
    }
    return keyPromise.then(function (key) {
      if (!key && create) { keyPromise = null; return getKey(true); }
      return key;
    });
  }
  async function encrypt(accounts, key) {
    var iv = randomBytes(12);
    var clear = encoder.encode(JSON.stringify({ accounts: accounts }));
    var cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: AAD }, key, clear);
    return { version: 2, iv: encoded(iv), data: encoded(new Uint8Array(cipher)) };
  }
  async function decrypt(record, key) {
    if (!record || record.version !== 2) throw new Error("Unsupported vault format");
    var clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decoded(record.iv), additionalData: AAD }, key, decoded(record.data));
    var parsed = JSON.parse(decoder.decode(clear));
    if (!parsed || !Array.isArray(parsed.accounts)) throw new Error("Invalid vault data");
    return parsed.accounts;
  }
  async function load() {
    var record = await storeGet(VAULT);
    if (!record) {
      if (await storeGet(OLD_VAULT)) return { migration: true };
      return { accounts: [], key: null };
    }
    var key = await getKey(false);
    if (!key) throw new Error("Encryption key is missing");
    return { accounts: await decrypt(record, key), key: key };
  }
  async function pinDigest(pin, salt) {
    var material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
    return encoded(new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2", salt: decoded(salt), iterations: 150000, hash: "SHA-256"
    }, material, 256)));
  }
  function equalDigest(a, b) {
    var left = decoded(a), right = decoded(b), diff = left.length ^ right.length;
    for (var i = 0; i < Math.min(left.length, right.length); i++) diff |= left[i] ^ right[i];
    return diff === 0;
  }
  async function migrate(passphrase) {
    var old = await storeGet(OLD_VAULT);
    if (!old || old.version !== 1) return { ok: false, error: "No previous vault found." };
    if (!passphrase || passphrase.length > 1024) return { ok: false, error: "Enter the previous vault password." };
    if (!Number.isInteger(old.iterations) || old.iterations < 100000 || old.iterations > 1000000)
      return { ok: false, error: "Previous vault format is unsupported." };
    try {
      var material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
      var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: decoded(old.salt),
        iterations: old.iterations, hash: "SHA-256" }, material, 256);
      var oldKey = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["decrypt"]);
      var clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decoded(old.iv),
        additionalData: encoder.encode(OLD_VAULT) }, oldKey, decoded(old.data));
      var parsed = JSON.parse(decoder.decode(clear));
      if (!parsed || !Array.isArray(parsed.accounts)) throw new Error("Invalid previous vault");
      var accounts = parsed.accounts.map(function (account) {
        account.mode = account.pinHash ? "pin" : "auto";
        return account;
      });
      var key = await getKey(true);
      await storeSet(VAULT, await encrypt(accounts, key));
      await storeRemove(OLD_VAULT);
      return { ok: true };
    } catch (_) { return { ok: false, error: "Incorrect previous vault password." }; }
  }
  async function handle(op, message, origin) {
    if (op === "migrate") return migrate(String(message.passphrase || ""));
    var state = await load();
    if (state.migration) return { ok: true, needsMigration: true };
    if (op === "list") return { ok: true, profiles: state.accounts
      .filter(function (a) { return a.origin === origin; })
      .map(function (a) { return { id: a.id, user: a.user,
        mode: a.mode || (a.pinHash ? "pin" : "auto"), hasPin: !!a.pinHash }; }) };
    if (op === "add") {
      var user = String(message.user || "").trim();
      var password = String(message.password || "");
      var mode = String(message.mode || "");
      var pin = String(message.pin || "");
      if (!user || !password || user.length > 256 || password.length > 512)
        return { ok: false, error: "Enter a valid User ID and Password." };
      if (mode !== "auto" && mode !== "pin") return { ok: false, error: "Choose a sign-in mode." };
      if (mode === "pin" && !/^[0-9]{4}$/.test(pin))
        return { ok: false, error: "Enter a four-digit PIN." };
      var account = { id: randomId(), origin: origin, user: user, password: password, mode: mode };
      if (mode === "pin") {
        account.pinSalt = encoded(randomBytes(16));
        account.pinHash = await pinDigest(pin, account.pinSalt);
      }
      var key = state.key || await getKey(true);
      // The same User ID saved again (a changed password, another sign-in mode) replaces its entry in place.
      var existing = state.accounts.findIndex(function (a) { return a.origin === origin && a.user === user; });
      if (existing >= 0) {
        account.id = state.accounts[existing].id;
        state.accounts[existing] = account;
      } else state.accounts.push(account);
      await storeSet(VAULT, await encrypt(state.accounts, key));
      return { ok: true, id: account.id, updated: existing >= 0 };
    }
    var id = String(message.id || "");
    if (!/^[0-9a-f]{32}$/.test(id)) return { ok: false, error: "Saved login not found." };
    var index = state.accounts.findIndex(function (a) { return a.id === id && a.origin === origin; });
    if (index < 0) return { ok: false, error: "Saved login not found." };
    if (op === "unlock") {
      var account = state.accounts[index];
      if (account.pinHash) {
        var supplied = String(message.pin || "");
        if (!/^[0-9]{4,8}$/.test(supplied) ||
            !equalDigest(await pinDigest(supplied, account.pinSalt), account.pinHash))
          return { ok: false, error: "Incorrect PIN" };
      }
      return { ok: true, user: account.user, password: account.password };
    }
    if (op === "remove") {
      state.accounts.splice(index, 1);
      await storeSet(VAULT, await encrypt(state.accounts, state.key));
      return { ok: true };
    }
    return { ok: false, error: "Unknown operation." };
  }
  chrome.runtime.onMessage.addListener(function (message, sender, reply) {
    if (!message || message.kind !== "bwCredential") return false;
    var page;
    try { page = new URL(sender.url || ""); } catch (_) { page = null; }
    if (!page || !sender.tab || page.protocol !== "https:" || !SITES.has(page.hostname) ||
        !/^\/commpilot\/Login\/?$/i.test(page.pathname) ||
        !["list", "add", "unlock", "remove", "migrate"].includes(message.op)) {
      reply({ ok: false, error: "Unauthorized credential request" });
      return false;
    }
    var run = function () { return handle(message.op, message, page.origin); };
    var work = ["add", "remove", "migrate"].includes(message.op)
      ? (mutationQueue = mutationQueue.then(run, run)) : run();
    Promise.resolve(work).then(reply).catch(function () {
      reply({ ok: false, error: "Could not open encrypted saved sign-ins." });
    });
    return true;
  });
})();
