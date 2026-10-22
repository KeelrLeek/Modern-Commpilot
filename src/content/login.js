/* The Login page, "Focus" (login.css). CommPilot's form stays whole underneath: its User ID and Password fields and its
   Login link move into the new page (their names, and CommPilot's handlers, go with them) and the table they came from
   is hidden. Saved sign-ins, the extension's encrypted vault (src/bg/credential-bridge.js), come first as "Continue as"
   rows. CommPilot's message (td.loginerror) and the vault's problems are toasts (toasts.js). Extras: show the password,
   a Caps Lock warning, the last User ID typed here filled in again (never the password), messages that go once you type,
   a small shake on a failed sign-in, and Sign in reachable from the keyboard. */
(function () {
  if (window !== window.top || !/^\/commpilot\/Login\/?$/i.test(location.pathname)) return;

  var USER_KEY = "cpLoginUser";
  var ICON = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    eye: '<path class="cp-login-eye-on" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle class="cp-login-eye-on" cx="12" cy="12" r="3"/>' +
      '<path class="cp-login-eye-off" d="M10.7 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>',
    caps: '<path d="M12 4 4 12h4v6h8v-6h4z"/>',
  };
  var svg = function (body) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + body + "</svg>"; };
  // CommPilot sometimes sends its line breaks as text ("…menu.<br>Summary: …"): they read as spaces.
  var clean = function (text) { return String(text || "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim(); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(label, cls) {
    var n = el("button", cls, label);
    n.type = "button";
    return n;
  }
  function field(type, placeholder, autocomplete) {
    var n = el("input", "cp-login-input");
    n.type = type;
    if (placeholder) n.placeholder = placeholder;
    n.autocomplete = autocomplete;
    return n;
  }
  function labelled(text, control) {
    var wrap = el("label", "cp-login-field");
    wrap.append(el("span", "cp-login-label", text), control);
    return wrap;
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
          done(chrome.runtime.lastError ? { ok: false, error: "Saved sign-ins are unavailable" } : result);
        });
      }
    } catch (_) { done({ ok: false, error: "Saved sign-ins are unavailable" }); }
  }
  // toasts.js comes in once the page is parsed, a little after this script's setup.
  var shown = [];
  function toast(message) {
    var tries = 0;
    (function show() {
      if (globalThis.cpToasts) { shown.push(globalThis.cpToasts.show(message)); return; }
      if (++tries < 80) setTimeout(show, 50);
    })();
  }
  function dismissToasts() {
    if (globalThis.cpToasts) shown.forEach(function (item) { if (item) globalThis.cpToasts.dismiss(item); });
    shown = [];
  }
  // "TriSandbox1002" → TS, "group.admin@example" → GA.
  function initials(name) {
    var words = String(name).replace(/[^A-Za-z0-9]+/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").trim().split(/\s+/);
    return (words.slice(0, 2).map(function (w) { return w[0]; }).join("") || "?").toUpperCase();
  }
  // A heartbeat across the window through the tile: flat, the Pulse's double beat just left of the tile, on to the
  // right edge, fading at both ends. The second path is the loading line (login.css), which runs in to the tile.
  function horizon() {
    var W = 2000, c = W / 2, y = 30, k = 1.7;
    var beatW = (2.4 * 2 + 4.2 + 2.9 * 2 + 1.2 + 9 + 4.2 * 2) * k;
    var start = c - 60 - beatW;
    var beat = "l" + 2.4 * k + "-" + 2.8 * k + " " + 2.4 * k + " " + 2.8 * k + "h" + 4.2 * k + "l" + 2.9 * k + "-" + 16.8 * k + " " +
      2.9 * k + " " + 17.8 * k + " " + 1.2 * k + "-" + k + "h" + 9 * k + "l" + 4.2 * k + "-" + 4.2 * k + " " + 4.2 * k + " " + 4.2 * k;
    var left = "M0 " + y + "H" + start + beat + "H" + c;
    return '<svg class="cp-login-horizon" viewBox="0 0 ' + W + ' 60" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<defs><linearGradient id="cp-login-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + W + '" y2="0">' +
      '<stop offset=".05" stop-color="currentColor" stop-opacity="0"/><stop offset=".42" stop-color="currentColor" stop-opacity=".75"/>' +
      '<stop offset=".5" stop-color="currentColor" stop-opacity=".9"/><stop offset=".95" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
      '<path class="cp-login-line" d="' + left + "H" + W + '"/><path class="cp-login-load" pathLength="1" d="' + left + '"/></svg>';
  }

  function setup() {
    var form = document.forms.namedItem("loginForm");
    if (!form || document.body.id !== "loginBody" || form.querySelector(".cp-login")) return;
    var user = form.elements.namedItem("EnteredUserID");
    var password = form.elements.namedItem("Password");
    var login = form.querySelector("td.logintext3 a");
    if (!user || !password || !login) return;
    var remember = form.elements.namedItem("rememberPass");
    if (remember) {
      remember.checked = false;
      remember.disabled = true;
      var rememberRow = remember.closest("tr");
      if (rememberRow) rememberRow.remove();
    }
    var runtime = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
    var brand = globalThis.cpBrand || {};
    var host = location.hostname.toLowerCase();
    var site = host.split(".").slice(0, -1).join(".") || host;
    var version = brand.version || runtime.getManifest().version;
    // CommPilot's message: a session that ended, or a sign-in that failed.
    var message = clean(form.querySelector("td.loginerror") && form.querySelector("td.loginerror").textContent);
    var signedOut = /session|log ?in again|sign ?in again|not authori[sz]ed|timed? ?out|expired/i.test(message);
    var userInteracted = false;
    var unlockRevision = 0;
    function cancelUnlocks() {
      unlockRevision++;
      if (saved) saved.querySelectorAll('.cp-login-acct.is-busy').forEach(function (row) {
        row.classList.remove('is-busy');
      });
    }
    [user, password, login].forEach(function (control) {
      control.addEventListener("input", function () { userInteracted = true; cancelUnlocks(); }, true);
      control.addEventListener("click", function () { userInteracted = true; cancelUnlocks(); }, true);
    });

    // The page.
    var root = el("div", "cp-login");
    var mark = el("div", "cp-login-mark");
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = horizon() + '<span class="cp-login-ping"></span><span class="cp-login-tile">' + (brand.tile || "") + "</span>";
    var meta = el("p", "cp-login-meta");
    meta.innerHTML = "<span><i></i></span>";
    meta.firstChild.append(site + " · v" + version);
    var saved = el("section", "cp-login-saved");
    var savedView = "accounts", savedViewRevision = 0, profileRequest = 0;
    saved.setAttribute("aria-label", "Saved sign-ins");
    saved.hidden = true;
    var or = el("p", "cp-login-or", "or sign in with your User ID");
    or.hidden = true;

    // CommPilot's fields, labelled; an eye shows the password, and a note says when Caps Lock is on.
    user.id = "cp-login-user";
    password.id = "cp-login-password";
    user.className = password.className = "cp-login-input";
    user.removeAttribute("size");
    password.removeAttribute("size");
    var fields = el("div", "cp-login-fields");
    var userField = el("div", "cp-login-field");
    var userLabel = el("label", "cp-login-label", "User ID");
    userLabel.htmlFor = user.id;
    userField.append(userLabel, user);
    var passwordField = el("div", "cp-login-field");
    var passwordLabel = el("label", "cp-login-label", "Password");
    passwordLabel.htmlFor = password.id;
    var secret = el("div", "cp-login-secret");
    var eye = btn("", "cp-login-eye");
    eye.innerHTML = svg(ICON.eye);
    secret.append(password, eye);
    var caps = capsNote();
    passwordField.append(passwordLabel, secret, caps);
    fields.append(userField, passwordField);
    function setEye(show) {
      password.type = show ? "text" : "password";
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
      eye.title = show ? "Hide password" : "Show password";
    }
    setEye(false);
    eye.addEventListener("mousedown", function (e) { e.preventDefault(); });   // the cursor stays in the field
    eye.addEventListener("click", function () { setEye(password.type === "password"); password.focus(); });
    watchCaps(password, caps);

    // CommPilot's Login link is the Sign in button, reachable from the keyboard.
    login.className = "cp-login-submit";
    login.setAttribute("role", "button");
    login.tabIndex = 0;
    login.innerHTML = '<span class="cp-login-spin" aria-hidden="true"></span><span class="cp-login-submit-text">Sign in</span>' + svg(ICON.arrow);
    login.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();   // no keypress either, so CommPilot's Enter handler does not send the form a second time
      login.click();
    });
    var saveNote = el("p", "cp-login-save");
    saveNote.hidden = true;
    var saveLink = btn("Save a sign-in for next time", "cp-login-link");
    saveNote.append(saveLink);
    saveLink.addEventListener("click", function () { showAdd(function () { loadProfiles(); }); });

    root.append(mark, el("h1", "cp-login-title", "Sign in to CommPilot"), meta, saved, or, fields, login, saveNote, legal());
    form.prepend(root);

    // The native link's listener runs before our bubble listener. Block a second
    // activation in capture, including keyboard-generated and programmatic clicks.
    root.addEventListener("click", function (e) {
      if (root.classList.contains("is-busy") && login.contains(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    // Enter in the User ID or the Password is CommPilot's own submit (its handler on the page). Enter anywhere else on
    // the page (a saved sign-in's PIN, the legal notice) stays there.
    root.addEventListener("keypress", function (e) {
      if (e.key !== "Enter") return;
      if (root.classList.contains("is-busy")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target === user || e.target === password) started(false);
      else e.stopPropagation();
    });
    login.addEventListener("click", function () { started(fromSaved); fromSaved = false; });
    root.addEventListener("input", dismissToasts);   // a message goes once you type again
    // Enter in a saved sign-ins form presses its button.
    saved.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || !e.target.matches("input") || e.target.closest(".cp-login-pin")) return;
      var primary = e.target.closest(".cp-login-panel") && e.target.closest(".cp-login-panel").querySelector(".cp-login-button.is-primary");
      if (primary) { e.preventDefault(); primary.click(); }
    });

    // The User ID typed here last time, and the cursor where it is needed.
    try { if (!user.value) user.value = localStorage.getItem(USER_KEY) || ""; } catch (_) {}
    (user.value ? password : user).focus();

    // CommPilot's message as a toast; a failed sign-in shakes the form.
    if (message) {
      toast(signedOut ? { severity: "warning", title: "You were signed out", body: message } :
        { severity: "error", title: "Couldn’t sign in", body: message });
      if (!signedOut && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        root.classList.add("is-shaking");
        setTimeout(function () { root.classList.remove("is-shaking"); }, 600);
      }
    }

    // Signing in: the button waits and the line runs in to the tile while CommPilot checks (as --cp-progress does on
    // every other page); CommPilot's answer replaces the page. Back to a page kept in the browser's cache resets it.
    var fromSaved = false, creep = 0;
    function started(bySaved) {
      cancelUnlocks();
      if (root.classList.contains("is-busy")) return;
      if (password.type !== "password") setEye(false);
      if (!bySaved) {
        try { if (clean(user.value)) localStorage.setItem(USER_KEY, clean(user.value)); } catch (_) {}
      }
      dismissToasts();
      busy(true);
    }
    function busy(on) {
      var html = document.documentElement, value = 0.08;
      root.classList.toggle("is-busy", on);
      login.querySelector(".cp-login-submit-text").textContent = on ? "Signing in…" : "Sign in";
      clearInterval(creep);
      if (!on) {
        html.removeAttribute("data-cp-progress");
        html.style.removeProperty("--cp-progress");
        return;
      }
      html.setAttribute("data-cp-progress", "on");
      html.style.setProperty("--cp-progress", String(value));
      creep = setInterval(function () {
        value += (0.92 - value) * 0.08;
        html.style.setProperty("--cp-progress", value.toFixed(3));
      }, 200);
    }
    addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      cancelUnlocks();
      busy(false);
      saved.querySelectorAll(".cp-login-acct.is-busy").forEach(function (row) { row.classList.remove("is-busy"); });
    });

    function capsNote() {
      var note = el("p", "cp-login-caps");
      note.innerHTML = svg(ICON.caps);
      note.append("Caps Lock is on");
      note.hidden = true;
      return note;
    }
    function watchCaps(input, note) {
      var check = function (e) { note.hidden = !(e.getModifierState && e.getModifierState("CapsLock")); };
      input.addEventListener("keydown", check);
      input.addEventListener("keyup", check);
      input.addEventListener("blur", function () { note.hidden = true; });
    }
    // Cisco's notice: its first line, the rest behind Legal notice ("Â©" is the page's own encoding).
    function legal() {
      var box = el("footer", "cp-login-legal");
      var cell = form.querySelector("td.copyright");
      if (!cell) return box;
      var walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) walk.currentNode.textContent = walk.currentNode.textContent.replace(/Â©/g, "©");
      var nodes = Array.prototype.slice.call(cell.childNodes);
      var br = nodes.findIndex(function (n) { return n.nodeName === "BR"; });
      var details = el("details");
      var summary = el("summary");
      var line = el("span");
      line.append.apply(line, br < 0 ? nodes : nodes.slice(0, br));
      summary.append(line, el("span", "cp-login-legal-toggle", "Legal notice"));
      var rest = el("div", "cp-login-legal-text");
      if (br >= 0) rest.append.apply(rest, nodes.slice(br + 1));
      details.append(summary, rest);
      box.append(details);
      return box;
    }

    // Saved sign-ins. The rows: an automatic one signs in at once; a PIN one opens its PIN box.
    function showAccounts(profiles) {
      savedView = "accounts";
      savedViewRevision++;
      saved.replaceChildren();
      saved.hidden = !profiles.length;
      or.hidden = !profiles.length;
      saveNote.hidden = !!profiles.length;
      if (!profiles.length) return;
      profiles.forEach(function (profile) { saved.append(account(profile)); });
      var manage = btn("Manage saved sign-ins", "cp-login-manage");
      manage.addEventListener("click", function () { showManage(profiles); });
      saved.append(manage);
    }
    function account(profile) {
      var row = el("div", "cp-login-acct");
      row.dataset.id = profile.id;
      var go = btn("", "cp-login-acct-go");
      var words = el("span");
      words.append(el("b", "", "Continue as " + (profile.user || "saved sign-in")),
        el("small", "", profile.hasPin ? "Asks for your PIN" : "Signs in right away"));
      go.append(el("span", "cp-login-avatar", initials(profile.user || "?")), words);
      go.insertAdjacentHTML("beforeend", '<span class="cp-login-spin" aria-hidden="true"></span>' + svg(ICON.chevron));
      row.append(go);
      if (!profile.hasPin) {
        go.addEventListener("click", function () { unlock(profile, "", row); });
        return row;
      }
      var box = el("div", "cp-login-pin");
      box.hidden = true;
      var pin = field("password", "PIN", "off");
      pin.inputMode = "numeric";
      pin.maxLength = 8;
      pin.setAttribute("aria-label", "PIN for " + (profile.user || "saved sign-in"));
      pin.addEventListener('input', cancelUnlocks);
      var go2 = btn("Continue", "cp-login-button is-primary");
      var note = capsNote();
      box.append(pin, go2, note);
      watchCaps(pin, note);
      row.append(box);
      go.setAttribute("aria-expanded", "false");
      go.addEventListener("click", function () {
        var open = !row.classList.contains("is-open");
        saved.querySelectorAll(".cp-login-acct.is-open").forEach(function (other) { if (other !== row) close(other); });
        if (open) { row.classList.add("is-open"); box.hidden = false; go.setAttribute("aria-expanded", "true"); pin.focus(); }
        else close(row);
      });
      pin.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); go2.click(); }
      });
      go2.addEventListener("click", function () {
        if (!/^[0-9]{4,8}$/.test(pin.value)) {
          toast({ severity: "warning", body: "Enter the PIN for " + (profile.user || "this sign-in") + "." });
          pin.focus();
          return;
        }
        unlock(profile, pin.value, row, pin);
      });
      return row;
    }
    function close(row) {
      if (row.classList.contains('is-busy')) cancelUnlocks();
      row.classList.remove("is-open");
      var box = row.querySelector(".cp-login-pin");
      if (box) box.hidden = true;
      row.querySelector(".cp-login-acct-go").setAttribute("aria-expanded", "false");
    }
    function openOnly(profile) {
      var row = saved.querySelector('.cp-login-acct[data-id="' + CSS.escape(String(profile.id)) + '"]');
      if (row && !row.classList.contains("is-open")) row.querySelector(".cp-login-acct-go").click();
    }
    // The vault gives the User ID and password to CommPilot's own fields, and CommPilot's Login link does the rest.
    function unlock(profile, pin, row, pinField) {
      if (!row || !row.isConnected || row.classList.contains("is-busy") || root.classList.contains("is-busy")) return;
      cancelUnlocks();
      var revision = unlockRevision, initialUser = user.value, initialPassword = password.value;
      row.classList.add("is-busy");
      request("unlock", { id: profile.id, pin: pin }, function (result) {
        if (revision !== unlockRevision) return;
        row.classList.remove('is-busy');
        if (!row.isConnected || root.classList.contains('is-busy') ||
            user.value !== initialUser || password.value !== initialPassword) return;
        if (!result || !result.ok) {
          row.classList.remove("is-busy");
          toast({ severity: "error", title: "Couldn’t open the saved sign-in", body: result && result.error || "Try again, or sign in with your User ID." });
          if (pinField) { pinField.value = ""; pinField.focus(); }
          return;
        }
        user.value = result.user || "";
        password.value = result.password || "";
        if (pinField) pinField.value = "";
        fromSaved = true;
        login.click();
      });
    }
    function loadProfiles(done) {
      var revision = savedViewRevision, sequence = ++profileRequest;
      request("list", null, function (result) {
        if (!root.isConnected || revision !== savedViewRevision || sequence !== profileRequest) return;
        if (!result || !result.ok) {
          showAccounts([]);
          if (done) done(null, result && result.error || "Saved sign-ins are unavailable");
          return;
        }
        if (result.needsMigration) { showMigration(); if (done) done(null); return; }
        var profiles = Array.isArray(result.profiles) ? result.profiles : [];
        showAccounts(profiles);
        if (done) done(profiles);
      });
    }

    // A completed vault operation still takes effect, but its response must not
    // replace a different draft opened while the operation was pending.
    function refreshSavedView(originBox) {
      if (savedView === "manage") loadProfiles(function (list) { if (list) showManage(list); });
      else if (savedView === "accounts" || originBox?.isConnected) loadProfiles();
    }

    // Managing them: remove one, add one, or move the old vault's across.
    function panel(title, backLabel, back) {
      savedViewRevision++;
      cancelUnlocks();
      saved.replaceChildren();
      saved.hidden = false;
      or.hidden = false;
      saveNote.hidden = true;
      var box = el("div", "cp-login-panel");
      var head = el("div", "cp-login-panel-head");
      head.append(el("h2", "", title));
      if (back) {
        var backButton = btn(backLabel, "cp-login-link");
        backButton.addEventListener("click", back);
        head.append(backButton);
      }
      box.append(head);
      saved.append(box);
      return box;
    }
    function showManage(profiles) {
      var box = panel("Saved sign-ins", "Done", function () { loadProfiles(); });
      savedView = "manage";
      if (!profiles.length) box.append(el("p", "cp-login-empty", "None saved in this browser yet."));
      profiles.forEach(function (profile) {
        var row = el("div", "cp-login-mrow");
        var remove = btn("Remove", "cp-login-link is-quiet");
        remove.setAttribute("aria-label", "Remove " + (profile.user || "saved sign-in"));
        row.append(el("b", "", profile.user || "Saved sign-in"), el("small", "", profile.hasPin ? "PIN" : "Automatic"), remove);
        remove.addEventListener("click", function () {
          if (!window.confirm("Remove the saved sign-in for " + (profile.user || "this account") + "?")) return;
          remove.disabled = true;
          request("remove", { id: profile.id }, function (result) {
            if (result && result.ok) {
              refreshSavedView(box);
              return;
            }
            remove.disabled = false;
            toast({ severity: "error", title: "Couldn’t remove the saved sign-in", body: result && result.error || "Try again in a moment." });
          });
        });
        box.append(row);
      });
      var actions = el("div", "cp-login-row-actions");
      var add = btn("Add a saved sign-in", "cp-login-button");
      add.addEventListener("click", function () {
        showAdd(function () { loadProfiles(function (list) { if (list) showManage(list); }); });
      });
      actions.append(add);
      box.append(actions, el("p", "cp-login-help",
        "Kept in this browser, encrypted. An automatic one signs in when this page opens if it is the only one saved."));
    }
    function showAdd(back) {
      var box = panel("Save a sign-in", "Cancel", back);
      savedView = "add";
      var id = field("text", "", "off");
      id.value = user.value;
      var secretField = field("password", "", "new-password");
      secretField.value = password.value;
      var mode = el("select", "cp-login-input");
      [["pin", "Ask for a four-digit PIN"], ["auto", "Sign in automatically"]].forEach(function (option) {
        var item = el("option", "", option[1]);
        item.value = option[0];
        mode.append(item);
      });
      var pin = field("password", "Four digits", "off");
      pin.inputMode = "numeric";
      pin.maxLength = 4;
      var pinField = labelled("Four-digit PIN", pin);
      mode.addEventListener("change", function () { pinField.hidden = mode.value !== "pin"; });
      var save = btn("Save sign-in", "cp-login-button is-primary");
      var actions = el("div", "cp-login-row-actions");
      actions.append(save);
      box.append(labelled("User ID", id), labelled("Password", secretField), labelled("Sign-in option", mode), pinField, actions);
      save.addEventListener("click", function () {
        var who = clean(id.value);
        if (!who || !secretField.value) { toast({ severity: "warning", body: "Enter the User ID and password to save." }); return; }
        if (mode.value === "pin" && !/^[0-9]{4}$/.test(pin.value)) { toast({ severity: "warning", body: "The PIN is four digits." }); pin.focus(); return; }
        save.disabled = true;
        request("add", { user: who, password: secretField.value, mode: mode.value, pin: pin.value }, function (result) {
          save.disabled = false;
          if (!result || !result.ok) {
            toast({ severity: "error", title: "Couldn’t save the sign-in", body: result && result.error || "Try again in a moment." });
            return;
          }
          secretField.value = "";
          pin.value = "";
          toast({ severity: "info", body: "Saved: " + who + "." });
          refreshSavedView(box);
        });
      });
      id.focus();
    }
    function showMigration() {
      var box = panel("Update saved sign-ins");
      savedView = "migration";
      var secretField = field("password", "", "current-password");
      var update = btn("Update", "cp-login-button is-primary");
      var actions = el("div", "cp-login-row-actions");
      actions.append(update);
      box.append(labelled("Previous vault password", secretField),
        el("p", "cp-login-help", "Enter it once to move your sign-ins from the previous version."), actions);
      update.addEventListener("click", function () {
        if (!secretField.value) { toast({ severity: "warning", body: "Enter your previous vault password." }); return; }
        update.disabled = true;
        request("migrate", { passphrase: secretField.value }, function (result) {
          update.disabled = false;
          secretField.value = "";
          if (result && result.ok) refreshSavedView(box);
          else toast({ severity: "error", title: "Couldn’t update saved sign-ins", body: result && result.error || "Try again in a moment." });
        });
      });
      secretField.focus();
    }

    // On arrival: the saved sign-ins. The only one, automatic, signs in by itself, unless CommPilot has something to
    // say, you have just signed out or it has just tried; the only one with a PIN opens its PIN box.
    loadProfiles(function (profiles) {
      if (!profiles || !profiles.length) return;
      var recentLogout = false, recentAttempt = false;
      try {
        recentLogout = Date.now() - Number(sessionStorage.getItem("bwManualLogoutAt") || 0) < 60000;
        recentAttempt = Date.now() - Number(sessionStorage.getItem("bwAutoLoginAttempt") || 0) < 60000;
      } catch (_) {}
      if (profiles.length !== 1 || userInteracted) return;
      var only = profiles[0];
      if (only.mode === "auto" && !message && !recentLogout && !recentAttempt && !/logout/i.test(document.referrer || "")) {
        try { sessionStorage.setItem("bwAutoLoginAttempt", String(Date.now())); } catch (_) {}
        unlock(only, "", saved.querySelector(".cp-login-acct"));
      } else if (only.hasPin) {
        openOnly(only);
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
