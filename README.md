# BroadWorks Enhancer PJAX Preview

This branch combines the original BroadWorks Enhancer controls with the PJAX transport from Modern-Commpilot. It leaves CommPilot's own CSS, menus, tables, forms, and header in place. The former `skin.js` and `skin.css` are retained in the Git history but are not loaded by this extension.

## Included behavior

- The original dropdown search, green/red On/Off labels, and breadcrumb Copy User ID / Copy Extension controls.
- PJAX navigation for the same URL families handled by Modern-Commpilot 0.2.346: reseller, service-provider, group and user pages; folder menus; list find/sort/page requests; entity drill-in; and the specific Operator/System and Schedule paths covered by its route matcher.
- Form-token rotation, bounded redirect-stub following, iframe transport for navigation-only entity pages, in-place server-error handling, back/forward replay, and same-origin reload recovery.
- PJAX refreshes the actual CommPilot breadcrumb cell and reattaches its native link handlers after each swap, preserving the full Reseller → Service Provider → Group → Users → User trail.
- Native CommPilot styling. The only added CSS styles the requested controls and small PJAX error notices.
- The existing Cisco login form is centered. Its logo, background image, fields, and submit logic remain intact. The old **Remember Password** row is removed. A compact **Saved sign-ins** drawer sits below the Cisco panel.
- You can save multiple sign-ins per BroadWorks host. Each account can sign in automatically or ask for a four-digit PIN. With one automatic account, visiting the login page signs in immediately; with several accounts, the page shows an account chooser. A single PIN account opens its PIN prompt. Saved passwords are AES-256-GCM ciphertext in extension storage. A non-extractable encryption key persists in extension IndexedDB so automatic sign-in works after browser restart. The PIN gates use of an account but is not a strong encryption secret.

A page outside the current PJAX route matcher continues through CommPilot's original navigation. The retained transport has not yet been validated on every production page. Use the sandbox host for further route-by-route testing before replacing the stable extension in production.

## Live local preview

In the source checkout, run `python dev-preview/server.py` and open `http://127.0.0.1:8765/preview`. This is a synthetic navigation test page using a saved CommPilot stylesheet; your actual site's own CSS is used when the extension is installed. The local page sends no requests to BroadWorks and refreshes after source edits. The install ZIP omits this development server.

## Install this preview

Extract the single `BroadWorks-Enhancer-PJAX-Preview.zip`. Chrome or Edge: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder. Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json`. Disable the stable BroadWorks Enhancer while testing this preview to avoid duplicate controls. No helper or separate installer is needed.

On the login page, open **Saved sign-ins**, choose **Add login**, enter your User ID and Password, and select **Sign in automatically** or **Ask for a four-digit PIN**. Later, choose an account if you have several saved. A PIN account asks for its PIN before using Cisco's original Login handler. Use **Remove** to delete a saved account. Saving is per BroadWorks host. Recent manual logout and login errors suppress an immediate automatic retry to avoid sign-in loops. Accounts saved by version 0.3.3 can be moved into this version by entering the previous vault password once.

Automatic sign-in requires the encryption key to persist in the browser profile. This protects passwords from casual inspection of extension storage, but a person or program with access to the browser profile and extension privileges may still use the key. The four-digit PIN is a convenience gate, not the equivalent of Windows Credential Manager or a master-password vault.

Logins saved by the earlier Windows-helper preview are not imported into this vault. They remain in Windows Credential Manager until you remove them separately; re-add them here if needed.

The extension ID in Chrome and Edge is pinned to `gahgpfcnalnjfnlchhlhknidgnpllojg`. Firefox uses `broadworks-enhancer-pjax@example.com`.

The extension is scoped to the seven known BroadWorks hosts. The PJAX code only runs under `/commpilot/`.

## Tests

Run `npm ci` and `npm test`. The tests load the extension in Chromium, exercise the prior enhancer cases, navigate through representative PJAX page families including an iframe drill-in, verify native CSS remains active, and test a reload recovery path. The saved-login test checks ciphertext storage, the non-extractable browser key, correct and incorrect PINs, account selection, automatic sign-in, and removal. Firefox lint reports no errors; it still reports warnings for `innerHTML` assignments in the inherited PJAX code.
