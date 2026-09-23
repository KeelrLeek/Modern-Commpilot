// Encrypted, extension-only credential vault. storage.local contains ciphertext;
// the derived key is kept only in storage.session until the browser closes.
(function () {
  "use strict";
  var SITES = new Set([
    "apps.avpaas.io", "apps01.avpaas.io", "apps02.avpaas.io",
    "apps-sbx.avpaas.io", "phone.tripbx.com", "phone1.tripbx.com",
    "phone2.tripbx.com"
  ]);
  var VAULT = "bwEncryptedVaultV1";
  var SESSION = "bwVaultKeyV1";
  var ITERATIONS = 600000;
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var mutationQueue = Promise.resolve();

  function encoded(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 8192)
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
    return btoa(parts.join(""));
  }
  function decoded(value) {
    var raw = atob(value);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function randomBytes(count) {
    return crypto.getRandomValues(new Uint8Array(count));
  }
  function randomId() {
    return Array.from(randomBytes(16), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function storeGet(area, key) {
    return new Promise(function (resolve, reject) {
      area.get(key, function (values) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(values ? values[key] : undefined);
      });
    });
  }
  function storeSet(area, key, value) {
    return new Promise(function (resolve, reject) {
      var values = {}; values[key] = value;
      area.set(values, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }
  function storeRemove(area, key) {
    return new Promise(function (resolve, reject) {
      area.remove(key, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }
  async function keyFromPassphrase(passphrase, salt, iterations) {
    var material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256"
    }, material, 256));
  }
  async function aesKey(bytes) {
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function decrypt(record, keyBytes) {
    if (!record || record.version !== 1) throw new Error("Vault format is unsupported");
    var clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decoded(record.iv), additionalData: encoder.encode(VAULT) },
      await aesKey(keyBytes), decoded(record.data));
    var result = JSON.parse(decoder.decode(clear));
    if (!result || !Array.isArray(result.accounts)) throw new Error("Vault data is invalid");
    return result.accounts;
  }
  async function encrypt(accounts, keyBytes, salt) {
    var iv = randomBytes(12);
    var clear = encoder.encode(JSON.stringify({ accounts: accounts }));
    var cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: encoder.encode(VAULT) },
      await aesKey(keyBytes), clear);
    return { version: 1, iterations: ITERATIONS, salt: salt,
      iv: encoded(iv), data: encoded(new Uint8Array(cipher)) };
  }
  async function unlocked() {
    var record = await storeGet(chrome.storage.local, VAULT);
    if (!record) return { locked: true, hasVault: false };
    var key64 = await storeGet(chrome.storage.session, SESSION);
    if (!key64) return { locked: true, hasVault: true };
    try {
      var key = decoded(key64);
      return { locked: false, record: record, key: key, accounts: await decrypt(record, key) };
    } catch (_) {
      await storeRemove(chrome.storage.session, SESSION);
      return { locked: true, hasVault: true };
    }
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
  async function handle(op, message, origin) {
    if (op === "initialize") {
      var passphrase = String(message.passphrase || "");
      if (passphrase.length < 12 || passphrase.length > 1024)
        return { ok: false, error: "Use a vault password of at least 12 characters." };
      if (await storeGet(chrome.storage.local, VAULT)) return { ok: false, error: "Vault already exists." };
      var salt = encoded(randomBytes(16));
      var key = await keyFromPassphrase(passphrase, decoded(salt), ITERATIONS);
      await storeSet(chrome.storage.local, VAULT, await encrypt([], key, salt));
      await storeSet(chrome.storage.session, SESSION, encoded(key));
      return { ok: true };
    }
    if (op === "unlockVault") {
      var record = await storeGet(chrome.storage.local, VAULT);
      if (!record || record.version !== 1) return { ok: false, error: "No saved vault found." };
      if (!Number.isInteger(record.iterations) || record.iterations < 100000 ||
          record.iterations > 1000000) return { ok: false, error: "Vault format is unsupported." };
      var candidate = String(message.passphrase || "");
      if (!candidate || candidate.length > 1024) return { ok: false, error: "Enter your vault password." };
      try {
        var derived = await keyFromPassphrase(candidate, decoded(record.salt), record.iterations);
        await decrypt(record, derived);
        await storeSet(chrome.storage.session, SESSION, encoded(derived));
        return { ok: true };
      } catch (_) { return { ok: false, error: "Incorrect vault password." }; }
    }
    if (op === "lockVault") {
      await storeRemove(chrome.storage.session, SESSION);
      return { ok: true };
    }
    var state = await unlocked();
    if (state.locked) return { ok: true, locked: true, hasVault: state.hasVault };
    if (op === "list") return { ok: true, profiles: state.accounts
      .filter(function (a) { return a.origin === origin; })
      .map(function (a) { return { id: a.id, user: a.user, hasPin: !!a.pinHash }; }) };
    if (op === "add") {
      var user = String(message.user || "").trim();
      var password = String(message.password || "");
      var pin = String(message.pin || "");
      if (!user || !password || user.length > 256 || password.length > 512)
        return { ok: false, error: "Enter a valid User ID and Password." };
      if (pin && !/^[0-9]{4,8}$/.test(pin))
        return { ok: false, error: "PIN must be 4–8 digits." };
      var account = { id: randomId(), origin: origin, user: user, password: password };
      if (pin) {
        account.pinSalt = encoded(randomBytes(16));
        account.pinHash = await pinDigest(pin, account.pinSalt);
      }
      state.accounts.push(account);
      await storeSet(chrome.storage.local, VAULT, await encrypt(state.accounts, state.key, state.record.salt));
      return { ok: true, id: account.id };
    }
    var id = String(message.id || "");
    if (!/^[0-9a-f]{32}$/.test(id)) return { ok: false, error: "Saved login not found." };
    var index = state.accounts.findIndex(function (a) { return a.id === id && a.origin === origin; });
    if (index < 0) return { ok: false, error: "Saved login not found." };
    if (op === "unlock") {
      var found = state.accounts[index];
      if (found.pinHash) {
        var supplied = String(message.pin || "");
        if (!/^[0-9]{4,8}$/.test(supplied) ||
            !equalDigest(await pinDigest(supplied, found.pinSalt), found.pinHash))
          return { ok: false, error: "Incorrect PIN" };
      }
      return { ok: true, user: found.user, password: found.password };
    }
    if (op === "remove") {
      state.accounts.splice(index, 1);
      await storeSet(chrome.storage.local, VAULT, await encrypt(state.accounts, state.key, state.record.salt));
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
        !["list", "initialize", "unlockVault", "lockVault", "add", "unlock", "remove"].includes(message.op)) {
      reply({ ok: false, error: "Unauthorized credential request" });
      return false;
    }
    // Serialize updates so two rapid Add/Remove clicks cannot overwrite each other.
    var run = function () { return handle(message.op, message, page.origin); };
    var work = ["initialize", "add", "remove", "lockVault", "unlockVault"].includes(message.op)
      ? (mutationQueue = mutationQueue.then(run, run)) : run();
    Promise.resolve(work).then(reply).catch(function () {
      reply({ ok: false, error: "Could not access encrypted saved sign-ins." });
    });
    return true;
  });
})();
