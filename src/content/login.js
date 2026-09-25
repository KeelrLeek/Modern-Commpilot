// Cisco's form stays intact; saved sign-ins use extension-origin encrypted storage.
(function () {
  if (window !== window.top || !/^\/commpilot\/Login\/?$/i.test(location.pathname)) return;

  function setup() {
    var form = document.forms.namedItem("loginForm");
    if (!form || document.body.id !== "loginBody" || form.querySelector(".bw-saved-login")) return;
    var runtime = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
    document.documentElement.style.setProperty("--cp-login-photo",
      'url("' + runtime.getURL("assets/login/comm-pilot-women-transparent.png") + '")');
    var user = form.elements.namedItem("EnteredUserID");
    var password = form.elements.namedItem("Password");
    var login = form.querySelector("td.logintext3 a");
    if (!user || !password || !login) return;
    var remember = form.elements.namedItem("rememberPass");
    var userInteracted = false;
    [user, password, login].forEach(function (control) {
      control.addEventListener("input", function () { userInteracted = true; }, true);
      control.addEventListener("click", function () { userInteracted = true; }, true);
    });
    if (remember) {
      remember.checked = false;
      remember.disabled = true;
      var row = remember.closest("tr");
      if (row) row.remove();
    }

    function el(tag, cls, content) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (content !== undefined) n.textContent = content;
      return n;
    }
    function btn(label, cls) {
      var n = el("button", cls || "bw-saved-button", label);
      n.type = "button";
      return n;
    }
    function field(type, placeholder, autocomplete) {
      var n = el("input", "bw-saved-input");
      n.type = type;
      n.placeholder = placeholder;
      n.autocomplete = autocomplete;
      return n;
    }
    function request(op, data, done) {
      var message = Object.assign({ kind: "bwCredential", op: op }, data || {});
      try {
        if (typeof browser !== "undefined") {
          browser.runtime.sendMessage(message).then(done).catch(function () {
            done({ ok: false, error: "Saved sign-ins are unavailable" });
          });
        } else {
          chrome.runtime.sendMessage(message, function (result) {
            done(chrome.runtime.lastError ?
              { ok: false, error: "Saved sign-ins are unavailable" } : result);
          });
        }
      } catch (_) { done({ ok: false, error: "Saved sign-ins are unavailable" }); }
    }

    var section = el("section", "bw-saved-login");
    section.setAttribute("aria-label", "Saved sign-ins");
    var trigger = btn("Saved sign-ins", "bw-saved-trigger");
    trigger.setAttribute("aria-expanded", "false");
    var marker = el("span", "bw-saved-marker", "▸");
    trigger.prepend(marker);
    var panel = el("div", "bw-saved-panel");
    panel.hidden = true;
    var status = el("p", "bw-saved-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var body = el("div", "bw-saved-body");
    panel.append(status, body);
    section.append(trigger, panel);
    form.appendChild(section);

    // CommPilot's document-level Enter handler submits its form; keep panel input local.
    section.addEventListener("keypress", function (e) {
      if (e.key === "Enter") e.stopPropagation();
    }, true);
    section.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.stopPropagation();
        if (e.target instanceof HTMLInputElement) {
          e.preventDefault();
          var action = body.querySelector(".bw-saved-primary");
          if (action) action.click();
        }
      }
    }, true);

    function note(message, error) {
      status.textContent = message || "";
      status.classList.toggle("bw-saved-error", !!error);
    }
    function openPanel() {
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      marker.textContent = "▾";
    }
    function performSignIn(profile, pin, action, pinField) {
      action.disabled = true;
      note("Opening saved login…");
      request("unlock", { id: profile.id, pin: pin }, function (result) {
        action.disabled = false;
        if (!result || !result.ok) {
          note(result && result.error || "Could not open saved login.", true);
          if (pinField) { pinField.value = ""; pinField.focus(); }
          return;
        }
        user.value = result.user || "";
        password.value = result.password || "";
        if (pinField) pinField.value = "";
        login.click();
      });
    }
    function loadProfiles() {
      note("Loading saved sign-ins…");
      request("list", null, function (result) {
        if (!result || !result.ok) {
          note(result && result.error || "Saved sign-ins are unavailable", true);
          body.replaceChildren();
        } else if (result.needsMigration) {
          note("");
          showMigration();
        } else {
          note("");
          showList(Array.isArray(result.profiles) ? result.profiles : []);
        }
      });
    }
    function showMigration() {
      body.replaceChildren(el("div", "bw-saved-heading", "Update saved sign-ins"));
      var passLabel = el("label", "bw-saved-label", "Previous vault password");
      var passField = field("password", "Previous vault password", "current-password");
      passLabel.appendChild(passField);
      body.appendChild(passLabel);
      body.appendChild(el("p", "bw-saved-help", "Enter this once to move sign-ins from the previous version."));
      var action = btn("Update", "bw-saved-button bw-saved-primary");
      action.addEventListener("click", function () {
        var secret = passField.value;
        if (!secret) { note("Enter your previous vault password.", true); return; }
        action.disabled = true;
        note("Updating saved sign-ins…");
        request("migrate", { passphrase: secret }, function (result) {
          action.disabled = false;
          passField.value = "";
          if (result && result.ok) loadProfiles();
          else note(result && result.error || "Could not update saved sign-ins.", true);
        });
      });
      body.appendChild(action);
      passField.focus();
    }
    function showList(profiles) {
      body.replaceChildren(el("div", "bw-saved-heading", "Saved sign-ins"));
      if (!profiles.length) body.appendChild(el("p", "bw-saved-empty", "No saved logins for this site."));
      profiles.forEach(function (profile) {
        var row = el("div", "bw-saved-account");
        var pick = btn(String(profile.user || "Saved login"), "bw-saved-account-name");
        pick.addEventListener("click", function () { showAccount(profile); });
        row.append(pick, el("span", "bw-saved-account-hint", profile.hasPin ? "PIN" : "Automatic"));
        body.appendChild(row);
      });
      var add = btn("Add login", "bw-saved-button bw-saved-primary");
      add.addEventListener("click", showAdd);
      body.appendChild(add);
    }
    function showAccount(profile) {
      note("");
      var back = btn("‹ Saved sign-ins", "bw-saved-back");
      back.addEventListener("click", loadProfiles);
      body.replaceChildren(back, el("div", "bw-saved-heading", String(profile.user || "Saved login")));
      var pinField;
      if (profile.hasPin) {
        var pinLabel = el("label", "bw-saved-label", "Four-digit PIN");
        pinField = field("password", "Four-digit PIN", "off");
        pinField.inputMode = "numeric";
        pinField.maxLength = 8;
        pinLabel.appendChild(pinField);
        body.appendChild(pinLabel);
      }
      var actions = el("div", "bw-saved-actions");
      var signIn = btn("Sign in", "bw-saved-button bw-saved-primary");
      signIn.addEventListener("click", function () {
        var pin = pinField ? pinField.value : "";
        if (profile.hasPin && !/^[0-9]{4,8}$/.test(pin)) {
          note("Enter your PIN.", true);
          pinField.focus();
          return;
        }
        performSignIn(profile, pin, signIn, pinField);
      });
      var remove = btn("Remove", "bw-saved-remove");
      remove.addEventListener("click", function () {
        if (!window.confirm("Remove this saved login?")) return;
        remove.disabled = true;
        request("remove", { id: profile.id }, function (result) {
          if (result && result.ok) loadProfiles();
          else { remove.disabled = false; note(result && result.error || "Could not remove saved login.", true); }
        });
      });
      actions.append(signIn, remove);
      body.appendChild(actions);
      if (pinField) pinField.focus();
      else signIn.click();
    }
    function showAdd() {
      note("");
      var back = btn("‹ Saved sign-ins", "bw-saved-back");
      back.addEventListener("click", loadProfiles);
      body.replaceChildren(back, el("div", "bw-saved-heading", "Add a saved login"));
      var idLabel = el("label", "bw-saved-label", "User ID");
      var idField = field("text", "User ID", "off");
      idField.value = user.value;
      idLabel.appendChild(idField);
      var passwordLabel = el("label", "bw-saved-label", "Password");
      var passwordField = field("password", "Password", "new-password");
      passwordField.value = password.value;
      passwordLabel.appendChild(passwordField);
      var modeLabel = el("label", "bw-saved-label", "Sign-in option");
      var modeField = el("select", "bw-saved-input");
      [["pin", "Ask for a four-digit PIN"], ["auto", "Sign in automatically"]].forEach(function (option) {
        var item = el("option", "", option[1]); item.value = option[0]; modeField.appendChild(item);
      });
      modeLabel.appendChild(modeField);
      var pinLabel = el("label", "bw-saved-label", "Four-digit PIN");
      var pinField = field("password", "Four digits", "off");
      pinField.inputMode = "numeric";
      pinField.maxLength = 4;
      pinLabel.appendChild(pinField);
      modeField.addEventListener("change", function () { pinLabel.hidden = modeField.value !== "pin"; });
      body.append(idLabel, passwordLabel, modeLabel, pinLabel);
      body.appendChild(el("p", "bw-saved-help", "Automatic sign-in starts when this page opens if it is your only saved account."));
      var save = btn("Save login", "bw-saved-button bw-saved-primary");
      save.addEventListener("click", function () {
        var id = idField.value.trim();
        var secret = passwordField.value;
        var pin = pinField.value;
        if (!id || !secret) { note("Enter User ID and Password.", true); return; }
        if (modeField.value === "pin" && !/^[0-9]{4}$/.test(pin)) { note("PIN must be four digits.", true); return; }
        save.disabled = true;
        note("Saving login…");
        request("add", { user: id, password: secret, mode: modeField.value, pin: pin }, function (result) {
          save.disabled = false;
          if (!result || !result.ok) {
            note(result && result.error || "Could not save login.", true);
            return;
          }
          passwordField.value = "";
          pinField.value = "";
          loadProfiles();
        });
      });
      body.appendChild(save);
      idField.focus();
    }
    trigger.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      trigger.setAttribute("aria-expanded", String(!panel.hidden));
      marker.textContent = panel.hidden ? "▸" : "▾";
      if (!panel.hidden) loadProfiles();
    });
    // One automatic account signs in on arrival. More than one account needs a choice.
    request("list", null, function (result) {
      if (!result || !result.ok) return;
      if (result.needsMigration) { openPanel(); showMigration(); return; }
      var profiles = Array.isArray(result.profiles) ? result.profiles : [];
      if (!profiles.length) return;
      var recentLogout = false, recentAttempt = false;
      try {
        recentLogout = Date.now() - Number(sessionStorage.getItem("bwManualLogoutAt") || 0) < 60000;
        recentAttempt = Date.now() - Number(sessionStorage.getItem("bwAutoLoginAttempt") || 0) < 60000;
      } catch (_) {}
      if (profiles.length === 1 && profiles[0].mode === "auto" &&
          !userInteracted && !recentLogout && !recentAttempt &&
          !/logout/i.test(document.referrer || "") &&
          !document.querySelector(".loginerror, .errorMessage, [class*=loginError]")) {
        try { sessionStorage.setItem("bwAutoLoginAttempt", String(Date.now())); } catch (_) {}
        var action = btn("Sign in", "bw-saved-button bw-saved-primary");
        performSignIn(profiles[0], "", action);
      } else {
        openPanel();
        showList(profiles);
        if (profiles.length === 1 && profiles[0].hasPin) showAccount(profiles[0]);
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
