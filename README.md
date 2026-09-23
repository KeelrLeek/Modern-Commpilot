# BroadWorks Enhancer PJAX Preview

This branch combines the original BroadWorks Enhancer controls with the PJAX transport from Modern-Commpilot. It leaves CommPilot's own CSS, menus, tables, forms, and header in place. The former `skin.js` and `skin.css` are retained in the Git history but are not loaded by this extension.

## Included behavior

- The original dropdown search, green/red On/Off labels, and breadcrumb Copy User ID / Copy Extension controls.
- PJAX navigation for the same URL families handled by Modern-Commpilot 0.2.346: reseller, service-provider, group and user pages; folder menus; list find/sort/page requests; entity drill-in; and the specific Operator/System and Schedule paths covered by its route matcher.
- Form-token rotation, bounded redirect-stub following, iframe transport for navigation-only entity pages, in-place server-error handling, back/forward replay, and same-origin reload recovery.
- PJAX refreshes the actual CommPilot breadcrumb cell and reattaches its native link handlers after each swap, preserving the full Reseller → Service Provider → Group → Users → User trail.
- Native CommPilot styling. The only added CSS styles the requested controls and small PJAX error notices.
- The existing Cisco login form is centered. Its logo, background image, fields, and submit logic remain intact. The old **Remember Password** row is removed. A compact **Saved sign-ins** drawer sits below the Cisco panel.
- You can save multiple sign-ins per BroadWorks host and optionally assign a 4–8 digit quick PIN to each. Choose a saved account and click **Sign in** to use it. Credentials are stored as Windows Generic Credentials for the current Windows user; the extension stores no password or PIN in browser storage. The PIN is a convenience gate for the helper, not a separate Windows account lock. The Windows helper uses native messaging and accepts requests only for the seven listed BroadWorks hosts.

A page outside the current PJAX route matcher continues through CommPilot's original navigation. The retained transport has not yet been validated on every production page. Use the sandbox host for further route-by-route testing before replacing the stable extension in production.

## Live local preview

In the source checkout, run `python dev-preview/server.py` and open `http://127.0.0.1:8765/preview`. This is a synthetic navigation test page using a saved CommPilot stylesheet; your actual site's own CSS is used when the extension is installed. The local page sends no requests to BroadWorks and refreshes after source edits. The install ZIP omits this development server.

## Install this preview

Chrome or Edge: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted extension folder. Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json`. Disable the stable BroadWorks Enhancer while testing this preview to avoid duplicate controls.

For Windows Credential Manager sign-in, extract the separate `BroadWorks-Credential-Helper-Windows.zip` and run `Install-CredentialHost.ps1` once under the same Windows account that runs the browser. It registers a small native helper for Chrome, Edge, and Firefox without administrator rights. On the login page, open **Saved sign-ins**, choose **Add login**, and enter your User ID, Password, and optional PIN. The account can later be selected for a one-click or PIN-assisted sign-in. Use **Remove** to delete it. Saving is per BroadWorks host. No saved account signs in automatically on page load.

The extension ID in Chrome and Edge is pinned to `gahgpfcnalnjfnlchhlhknidgnpllojg` so the native helper can authorize exactly this extension. Firefox uses `broadworks-enhancer-pjax@example.com`.

The extension is scoped to the seven known BroadWorks hosts. The PJAX code only runs under `/commpilot/`.

## Tests

Run `npm ci` and `npm test`. The tests load the extension in Chromium, exercise the prior enhancer cases, navigate through representative PJAX page families including an iframe drill-in, verify native CSS remains active, and test a reload recovery path. The Windows Credential Manager helper is tested with disposable accounts, including correct and incorrect PINs. Firefox lint reports no errors; it still reports warnings for `innerHTML` assignments in the inherited PJAX code.
