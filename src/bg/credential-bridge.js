// Native messaging is only available in the extension background context.
// Accept requests from this extension's content script on a known login page.
(function () {
  var HOST = "com.broadworks.enhancer.credentials";
  var SITES = new Set([
    "apps.avpaas.io", "apps01.avpaas.io", "apps02.avpaas.io",
    "apps-sbx.avpaas.io", "phone.tripbx.com", "phone1.tripbx.com",
    "phone2.tripbx.com"
  ]);

  chrome.runtime.onMessage.addListener(function (message, sender, reply) {
    if (!message || message.kind !== "bwCredential") return false;
    var page;
    try { page = new URL(sender.url || ""); } catch (_) { return false; }
    if (!sender.tab || page.protocol !== "https:" || !SITES.has(page.hostname) ||
        !/^\/commpilot\/Login\/?$/i.test(page.pathname) ||
        !["list", "add", "unlock", "remove"].includes(message.op)) {
      reply({ ok: false, error: "Unauthorized credential request" });
      return false;
    }

    var request = { op: message.op, origin: page.origin };
    if (message.op === "add") {
      request.user = String(message.user || "");
      request.password = String(message.password || "");
      if (!request.user || !request.password || request.user.length > 256 ||
          request.password.length > 512) {
        reply({ ok: false, error: "Enter a valid User ID and Password" });
        return false;
      }
      request.pin = String(message.pin || "");
      if (request.pin && !/^[0-9]{4,8}$/.test(request.pin)) {
        reply({ ok: false, error: "PIN must be 4 to 8 digits" });
        return false;
      }
    }
    if (message.op === "unlock" || message.op === "remove") {
      request.id = String(message.id || "");
      if (request.id !== "legacy" && !/^[0-9a-f]{32}$/.test(request.id)) {
        reply({ ok: false, error: "Saved login not found" });
        return false;
      }
      if (message.op === "unlock") {
        request.pin = String(message.pin || "");
        if (request.pin.length > 8 || (request.pin && !/^[0-9]+$/.test(request.pin))) {
          reply({ ok: false, error: "Invalid PIN" });
          return false;
        }
      }
    }

    try {
      if (typeof browser !== "undefined") {
        browser.runtime.sendNativeMessage(HOST, request).then(reply).catch(function () {
          reply({ ok: false, error: "Windows credential helper is unavailable" });
        });
      } else {
        chrome.runtime.sendNativeMessage(HOST, request, function (response) {
          if (chrome.runtime.lastError) {
            reply({ ok: false, error: "Windows credential helper is unavailable" });
          } else {
            reply(response || { ok: false, error: "No response from credential helper" });
          }
        });
      }
    } catch (_) {
      reply({ ok: false, error: "Windows credential helper is unavailable" });
      return false;
    }
    return true;
  });
})();
