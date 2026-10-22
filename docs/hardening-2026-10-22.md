# Evening and overnight hardening — October 21–22, 2026

This report covers the evening/overnight audit requested for BroadWorks Enhancer. The audit inventoried all 52 packaged runtime files, reviewed the active background/content/popup modules and shared styles, and concentrated integration testing on navigation, session handling, native forms and bulk workflows. The large PJAX module was reviewed by functional area; this is not a claim that every possible branch or live PBX configuration was exhaustively verified.

The user requested a stopping point to limit usage on the morning of October 22. The heartbeat was paused, a redundant full rerun was cancelled, and further memory experiments were cancelled. Final validation completed at approximately 07:07 Chicago time. Version remains **0.3.82**; no release ZIP, tag or published release is being replaced.

## What changed overnight

### Session handling and unexpected sign-in

- Preserved newly rotated session tokens even when a newer click cancels painting an older response. This covers ordinary navigation, menu-board reads and uploads.
- Distinguished HTTP failures, interrupted frame responses, incomplete pages and timeouts from genuine authentication rejection. Inconclusive failures preserve the current page and draft and show an actionable error.
- Retained application tokens returned with HTTP errors without treating their documents as usable menus or forms. Authentication-form tokens are not adopted.
- Added bounded deadlines and reliable settlement/cleanup for stalled reads, uploads, refreshes and hidden-frame navigation. A missing response does not authorize repeating a save.
- Fixed recovery failures incorrectly exhausting the sign-in-loop allowance. Genuine unresolved authentication loops and explicit expiry still stop; authentication was not weakened and no keepalive was added.
- Hardened recovery persistence against invalidated extension contexts, rejected storage operations, malformed records, stale callbacks and unchanged-token overwrites from idle tabs.
- Kept recovery tied to the current tab and appropriate administrator level rather than reopening another tab's saved user or always falling back to reseller home.

### History, refresh and navigation ownership

- Cleared failed Back/Forward replay state so the next ordinary click creates the correct history entry.
- Preserved query-selected tabs, relative native routes and entity ancestry across ordinary and hidden-frame redirects.
- Fixed in-shell refresh targeting the wrong page, adding duplicate Back entries, or overriding a newer navigation.
- Kept Apply, Save, Submit, Delete, credential changes and serialized forms out of replayable history/recovery state.
- Prevented navigation, refresh or dialog closure from releasing a bulk operation's group/user context while its final native request or return navigation is still pending.
- Rejected malformed, encoded mutation/logout, foreign-origin and credential-bearing replay/navigation destinations. A rejected destination does not discard the current valid token.
- Validated corrupted recent-location and menu-cache records without losing valid independent entries.

### Native forms, device profiles and scripts

- Preserved original fieldsets, hidden metadata and form ancestry through layout enhancement, including inherited disabled states and synchronous native validation.
- Honored disabled fieldsets, options, optgroups, radio choices, Apply buttons and locked caller-ID fields in both enhanced controls and bulk setters.
- Corrected dynamic schedule controls and date/time clearing while retaining native submitted values.
- Used native DOM/form methods for hidden transport forms so fields named `submit`, `appendChild` or `parentNode` cannot break dispatch or cleanup.
- Corrected Prototype 1.6.1 cleanup compatibility and removed completed hidden-frame deadlines/forms.
- Ordered native dependencies and inline initialization, held navigation while native scripts were still pending, and prevented a late validator from replacing the next page's validator.
- Removed temporary executed script nodes while retaining necessary shared-library behavior.
- Restricted redirect/action/sidebar metadata parsing to executable native script content. JSON, comments, quoted examples, external fallback text and inactive scripts cannot provide navigation bindings.
- Matched exact control IDs and current-page wiring, preserving escaped/Unicode identifiers and avoiding stale page-head bindings or prefix collisions.

### Bulk creation, number assignment and cleanup

- Made readiness checks linear in the batch size instead of rebuilding plans inside pairwise duplicate checks.
- Fixed the 200-user paste limit's empty starter-row handling; rejected or extension-exhausted pastes leave the existing batch unchanged.
- Preserved country codes and raw international identifiers through number lookup, review and native provisioning. London-number fixtures verify caller ID and Line/Ports.
- Stopped failed or incomplete number searches from silently becoming “not found,” and required complete department/assignment data before saving or claiming verification.
- Validated exact activation membership rather than only comparing counts; duplicate or changed members cannot pass a count-only check.
- Prevented profile cleanup from reporting “already absent” or “deleted and verified” when a matching row has incomplete native action metadata.
- Kept operation ownership through slow native responses and final returns. Ordinary per-user failures can continue; uncertain credential writes require acknowledgement and are not replayed.
- Preserved native disabled/locked group policies and rejected malformed extension limits instead of silently removing validation.
- Corrected nested Options/Paste/Details dialog modality, keyboard focus, Escape/Tab behavior, close timing and narrow/light/dark layouts.
- Verified the real manifest's MAIN/isolated-world flow for mixed DID and extension-only users, primary and Webex profiles, mailbox/PIN setup, final IM&P ordering and group-default persistence without passwords.

### Search, paging and exports

- Rejected missing/repeated/wrong pages, changed totals, wrong table identity, server errors, truncated searches and cancelled collection as complete results.
- Kept unknown totals truthful and retained the explicit User ID search fallback.
- Preserved atomic final result reveal after collection, formatting, paging and fonts; removed staggered final-row display.
- Corrected final-page layout behavior and malformed local paging events.
- Added export ownership, cancellation, deadlines and response validation. HTTP/HTML error bodies cannot be downloaded as successful ZIP/workbook results.
- Corrected exact device-export targets and reserved-looking user/department keys in directory reports.
- Bounded actual decompressed workbook data and rejected malformed shared-string/Boolean identifier cells before partial imports or PBX lookups.
- Set ZIP UTF-8 filename flags correctly; independent Python readback verified the Unicode filename and workbook XML.

### Login, settings, updates and UI lifecycle

- Prevented repeated Enter/link activation from sending multiple native sign-ins while one is pending.
- Invalidated stale saved-account unlock, list, add and remove responses after typing, switching accounts or leaving the picker.
- Settled aborted encryption-key transactions so later credential operations can proceed safely.
- Preserved intentional sign-out when storage fails; inconclusive sign-out results offer explicit retry rather than pretending completion.
- Serialized/coalesced popup and Settings writes and ignored stale initial reads so older responses cannot overwrite newer theme/font selections.
- Handled malformed debug/update preference payloads and storage callback failures without crashing the UI.
- Kept unrelated update-channel notifications from clearing the current channel's result or download.
- Released detached branding/list observer targets, corrected stale sort chevrons and coalesced repeated decoration work.
- Kept passwords, PIN/passcode fields, tokens and hidden controls out of generic Peek and persisted navigation. Existing diagnostic-redaction tests remain in the suite.
- Retained the extension's existing fonts, themes, palettes and reduced-motion behavior.

## Measured improvements

These are controlled synthetic measurements, not promised production load times.

| Workload | Before | After |
| --- | --- | --- |
| Readiness edit in a 199-user batch | 157,608 plan calls; about 189 ms | 199 calls; about 3–4 ms |
| Layout of a select containing 17,270 options | median 190 ms | 150 ms source; 159 ms installed |
| Bursts of form/icon/list/copy decoration notifications | roughly 90–100 passes | one scheduled pass |
| Four-number assignment preview | eight native navigation requests | two |
| Action parsing for 5,000 result rows | about 8 ms | about 1 ms |
| Menu cache over repeated entities | 201 records / 71,854 characters | capped at 64 records / 24,480 characters |

## Verification and limits

The final installed-copy regression passed **97/97**, including actual manifest-loaded bulk provisioning, group-default storage, device/history/frame handling and the corrected login lifecycle test. Chrome's injected-runtime boundary suite passed **52/52**; this is not a claim of full manifest validation in Chrome. The corrected canonical login test file independently passed **2/2**.

The final immutable full-suite run completed **904 tests: 903 passed and one failed**, exit code 1, in approximately 65.7 minutes. Its sole failure was the transient login-animation assertion described below. Its runtime is byte-identical to the final candidate; subsequent changes only corrected that assertion and test-file whitespace. The corrected test passed independently and within the final installed-copy regression. The full suite was not rerun after that test-only correction, so this run is not presented as a clean full-suite pass. All 417 snapshot hashes remained unchanged through the run.

Integrity checks verified all **417** frozen candidate files against source, and all **52 runtime files, 178 assets and the manifest** against the installed copy. There are no missing manifest references. Both copies remain version **0.3.82**. The redundant full rerun was cancelled at the user's request and is not counted as a pass.

Completed evidence includes clean immutable full suites at earlier checkpoints: 512, 568, 619, 810 and 864 tests respectively. These counts are per revision, not additive unique coverage. The latest runtime's focused error-boundary suite passed 14/14, and its frame/action regression passed 73/73. Actual manifest-loaded bulk provisioning and group-default storage checks passed.

The completed installed 500-visit board run on an earlier validated revision made 7,014 synthetic requests without page errors, save/authentication requests or native-navigation fallbacks. Context and rotating-token checks passed. Documents/nodes/listeners stayed at 4/365/173; history and menu caches remained bounded. JavaScript heap largely leveled, from 4.66 MB at 50 visits to 5.06 MB at 500. The separate 100-visit follow-up used the final runtime.

Native embedder heap grew in that run. A separate 100-visit follow-up passed and measured 5.78 MB at completion, 4.97 MB after settling/repeated garbage collection, and 4.94 MB after clearing resource timings. This remains an open profiling item. The queued inspector/snapshot experiment was cancelled at the user's stopping request; it was not completed and no speculative memory fix was applied.

Two superseded device-notice assertions and a transient login-animation assertion caused failures in intermediate full runs. Corrected assertions were checked against unchanged runtime; the login test now observes animation start and finish instead of requiring a 600 ms class to remain present. Those original failed runs are not counted as clean passes.

All automated browser work used isolated headless synthetic/intercepted PBX fixtures or a local test server. The user's browser and live accounts were not controlled. No live production logout/call-registration cause is claimed. Simultaneous-tab server policy, live device registration/calling and Firefox runtime behavior still require separate validation. Genuine session expiry remains effective.

## Earlier work included in the repository handoff

The checkout already contained uncommitted implementation of the Stable/Nightly checker, broader group setup and mixed-user provisioning, voicemail/Webex/IM&P settings, international-number handling, diagnostics and search-edge styling. That work was preserved, audited and tested; it is included with its required modules so the committed manifest and source are coherent. It is not being presented as all newly authored overnight.

Local recordings, customer screenshots, raw audit snapshots/logs and old release ZIPs are excluded from this commit. The separate HTML Recorder project is unchanged. The installed unpacked copy must be reloaded and CommPilot refreshed after unsaved work is finished; files being synchronized does not mean an already-open browser has loaded them.
