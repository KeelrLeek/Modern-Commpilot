// Cisco's form stays intact; the extension stores an encrypted login vault.
(function () {
  if (window !== window.top || !/^\/commpilot\/Login\/?$/i.test(location.pathname)) return;

  function setup() {
    var form = document.forms.namedItem("loginForm");
    if (!form || document.body.id !== "loginBody" || form.querySelector(".bw-saved-login")) return;
    var user = form.elements.namedItem("EnteredUserID");
    var password = form.elements.namedItem("Password");
    var login = form.querySelector("td.logintext3 a");
    if (!user || !password || !login) return;
    var remember = form.elements.namedItem("rememberPass");
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
    function loadProfiles() {
      note("Loading saved sign-ins…");
      request("list", null, function (result) {
        if (!result || !result.ok) {
          note(result && result.error || "Saved sign-ins are unavailable", true);
          body.replaceChildren();
        } else if (result.locked) {
          note("");
          showVaultGate(!!result.hasVault);
        } else {
          note("");
          showList(Array.isArray(result.profiles) ? result.profiles : []);
        }
      });
    }
    function showVaultGate(hasVault) {
      var create = !hasVault;
      body.replaceChildren(el("div", "bw-saved-heading",
        create ? "Create encrypted saved sign-ins" : "Unlock saved sign-ins"));
      var passLabel = el("label", "bw-saved-label", "Vault password");
      var passField = field("password", create ? "At least 12 characters" : "Vault password",
        create ? "new-password" : "current-password");
      passLabel.appendChild(passField);
      body.appendChild(passLabel);
      var confirmField;
      if (create) {
        var confirmLabel = el("label", "bw-saved-label", "Confirm vault password");
        confirmField = field("password", "Repeat vault password", "new-password");
        confirmLabel.appendChild(confirmField);
        body.appendChild(confirmLabel);
      }
      body.appendChild(el("p", "bw-saved-help", create
        ? "This password encrypts your saved logins. You will need it after restarting the browser."
        : "Enter this once per browser session to open your encrypted logins."));
      var action = btn(create ? "Create vault" : "Unlock", "bw-saved-button bw-saved-primary");
      action.addEventListener("click", function () {
        var secret = passField.value;
        if (create && secret.length < 12) {
          note("Use at least 12 characters for the vault password.", true); return;
        }
        if (create && secret !== confirmField.value) {
          note("Vault passwords do not match.", true); return;
        }
        if (!secret) { note("Enter your vault password.", true); return; }
        action.disabled = true;
        note(create ? "Creating encrypted vault…" : "Unlocking saved sign-ins…");
        request(create ? "initialize" : "unlockVault", { passphrase: secret }, function (result) {
          action.disabled = false;
          passField.value = "";
          if (confirmField) confirmField.value = "";
          if (result && result.ok) loadProfiles();
          else note(result && result.error || "Could not open the vault.", true);
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
        row.append(pick, el("span", "bw-saved-account-hint", profile.hasPin ? "PIN" : ""));
        body.appendChild(row);
      });
      var add = btn("Add login", "bw-saved-button bw-saved-primary");
      add.addEventListener("click", showAdd);
      body.appendChild(add);
      var lock = btn("Lock saved sign-ins", "bw-saved-remove");
      lock.addEventListener("click", function () {
        request("lockVault", null, function (result) {
          if (result && result.ok) loadProfiles();
          else note(result && result.error || "Could not lock saved sign-ins.", true);
        });
      });
      body.appendChild(lock);
    }
    function showAccount(profile) {
      note("");
      var back = btn("‹ Saved sign-ins", "bw-saved-back");
      back.addEventListener("click", loadProfiles);
      body.replaceChildren(back, el("div", "bw-saved-heading", String(profile.user || "Saved login")));
      var pinField;
      if (profile.hasPin) {
        var pinLabel = el("label", "bw-saved-label", "Quick PIN");
        pinField = field("password", "4–8 digit PIN", "off");
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
          note("Enter your 4–8 digit PIN.", true);
          pinField.focus();
          return;
        }
        signIn.disabled = true;
        note("Opening saved login…");
        request("unlock", { id: profile.id, pin: pin }, function (result) {
          signIn.disabled = false;
          if (result && result.locked) { loadProfiles(); return; }
          if (!result || !result.ok) {
            note(result && result.error || "Could not open saved login.", true);
            if (pinField) { pinField.value = ""; pinField.focus(); }
            return;
          }
          user.value = result.user || "";
          password.value = result.password || "";
          if (pinField) pinField.value = "";
          login.click(); // Cisco's own handler sets its hidden UserID and submits.
        });
      });
      var remove = btn("Remove", "bw-saved-remove");
      remove.addEventListener("click", function () {
        if (!window.confirm("Remove this saved login?")) return;
        remove.disabled = true;
        request("remove", { id: profile.id }, function (result) {
          if (result && result.locked) { loadProfiles(); return; }
          if (result && result.ok) loadProfiles();
          else { remove.disabled = false; note(result && result.error || "Could not remove saved login.", true); }
        });
      });
      actions.append(signIn, remove);
      body.appendChild(actions);
      if (pinField) pinField.focus();
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
      var pinLabel = el("label", "bw-saved-label", "Quick PIN (optional)");
      var pinField = field("password", "4–8 digits", "off");
      pinField.inputMode = "numeric";
      pinField.maxLength = 8;
      pinLabel.appendChild(pinField);
      body.append(idLabel, passwordLabel, pinLabel);
      body.appendChild(el("p", "bw-saved-help", "Encrypted in this browser. The optional PIN works after the vault is unlocked."));
      var save = btn("Save login", "bw-saved-button bw-saved-primary");
      save.addEventListener("click", function () {
        var id = idField.value.trim();
        var secret = passwordField.value;
        var pin = pinField.value;
        if (!id || !secret) { note("Enter User ID and Password.", true); return; }
        if (pin && !/^[0-9]{4,8}$/.test(pin)) { note("PIN must be 4–8 digits.", true); return; }
        save.disabled = true;
        note("Saving login…");
        request("add", { user: id, password: secret, pin: pin }, function (result) {
          save.disabled = false;
          if (result && result.locked) { loadProfiles(); return; }
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
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
