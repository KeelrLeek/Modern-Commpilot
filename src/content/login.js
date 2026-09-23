// Keeps Cisco's login form intact. Credentials live only in Windows Credential
// Manager, accessed through the extension's native messaging helper.
(function () {
  if (window !== window.top || !/^\/commpilot\/Login\/?$/i.test(location.pathname)) return;

  function setup() {
    var form = document.forms.namedItem("loginForm");
    if (!form || document.body.id !== "loginBody") return;
    var user = form.elements.namedItem("EnteredUserID");
    var password = form.elements.namedItem("Password");
    var remember = form.elements.namedItem("rememberPass");
    var login = form.querySelector("td.logintext3 a");
    if (!user || !password || !remember || !login) return;

    var cell = remember.closest("td");
    if (!cell || cell.querySelector(".bw-login-auto-choice")) return;
    var label = document.createElement("label");
    label.className = "bw-login-auto-choice";
    label.title = "Save this login in Windows Credential Manager";
    var toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.autocomplete = "off";
    label.append(toggle, document.createTextNode("Auto sign in"));
    cell.appendChild(label);

    var status = document.createElement("span");
    status.className = "bw-login-auto-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    cell.appendChild(status);
    var userInteracted = false;

    function note(text, error) {
      status.textContent = text;
      status.classList.toggle("bw-login-auto-error", !!error);
    }

    function request(op, data, done) {
      var message = Object.assign({ kind: "bwCredential", op: op }, data || {});
      try {
        if (typeof browser !== "undefined") {
          browser.runtime.sendMessage(message).then(done).catch(function () {
            done({ ok: false, error: "Credential helper unavailable" });
          });
        } else {
          chrome.runtime.sendMessage(message, function (result) {
            done(chrome.runtime.lastError ?
              { ok: false, error: "Credential helper unavailable" } : result);
          });
        }
      } catch (_) { done({ ok: false, error: "Credential helper unavailable" }); }
    }

    function hasLoginError() {
      var error = form.querySelector(".loginerror");
      return !!(error && (error.textContent || "").trim());
    }

    function cameFromLogout() {
      try {
        if (/\/Logout\/?|\/servlet\/Logout/i.test(new URL(document.referrer).pathname)) return true;
      } catch (_) {}
      try {
        var last = Number(sessionStorage.getItem("bwManualLogoutAt") || 0);
        return last > 0 && Date.now() - last < 30000;
      } catch (_) { return false; }
    }

    document.addEventListener("keydown", function (event) {
      if (event.isTrusted) userInteracted = true;
    }, true);
    document.addEventListener("pointerdown", function (event) {
      if (event.isTrusted) userInteracted = true;
    }, true);

    toggle.addEventListener("change", function () {
      userInteracted = true;
      if (toggle.checked) {
        if (!user.value || !password.value) {
          toggle.checked = false;
          note("Enter User ID and Password first.", true);
          return;
        }
        toggle.disabled = true;
        request("save", { user: user.value, password: password.value }, function (result) {
          toggle.disabled = false;
          if (result && result.ok) note("Saved in Windows Credential Manager.", false);
          else {
            toggle.checked = false;
            note("Install the Windows credential helper first.", true);
          }
        });
      } else {
        toggle.disabled = true;
        request("delete", null, function (result) {
          toggle.disabled = false;
          if (result && result.ok) note("Saved login removed.", false);
          else {
            toggle.checked = true;
            note("Could not remove the saved login.", true);
          }
        });
      }
    });

    request("get", null, function (result) {
      if (userInteracted || !result || !result.ok || !result.found) return;
      user.value = result.user || "";
      password.value = result.password || "";
      toggle.checked = !!(user.value && password.value);
      if (!toggle.checked || hasLoginError() || cameFromLogout()) return;
      // CommPilot's click handler sets its hidden UserID and posts the native form.
      login.click();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
