# CommPilot PJAX route audit

Live sandbox account, Edge with the unpacked preview extension. A **PJAX pass** means the destination rendered with HTTP 200 and the top-level document marker stayed the same. Opening a form here does not submit or save it. The visual, live-updating tally is at `http://127.0.0.1:8766/pjax-route-audit.html`; this note preserves the first walkthrough only. The current extension build is 0.3.8, with 680 discovered routes passing and all 174 discovered subpages scanned for further controls.

## Tally

| Check | Passed | Needs PJAX or repair | Not yet checked |
| --- | ---: | ---: | ---: |
| Distinct destination routes | 10 | 0 | Inventory in progress |
| Search actions | 2 | 0 | More list types |
| Back/Forward flows | 2 | 0 | More entity levels |

## Checked live

| Area | Destination or action | Result |
| --- | --- | --- |
| Reseller | `/commpilot/Reseller/Groups/` | PJAX pass |
| Reseller | Groups search | PJAX pass, four group rows |
| Group entry | `/commpilot/Reseller/Groups/Modify/index.jsp` | PJAX pass |
| Group | `/commpilot/Group/Members/` | PJAX pass |
| Group | Users search | PJAX pass, two users; a filtered user search also passed earlier |
| User entry | `/commpilot/Group/Members/Modify/index.jsp` | PJAX pass |
| User | `/commpilot/User/Addresses/` | PJAX pass |
| Group | `/commpilot/Group/Schedules/` | PJAX pass |
| Schedule | `/commpilot/Group/Schedules/Modify/index.jsp` | PJAX pass |
| Schedule event | `/commpilot/Group/Schedules/Events/Modify/index.jsp` | PJAX pass |
| Calling Plan | `/commpilot/Group/Calling_Plan/CodesMgmt/` | PJAX pass |
| Calling Plan drill-in | `/commpilot/Group/Calling_Plan/CodesMgmt/Modify/index.jsp` | PJAX pass; covered by expanded deep-route matcher |
| User history | Users → user menu → Addresses → Back → Forward | PJAX pass; same document marker |
| Calling Plan history | Codes Management → Modify → Back → Forward | PJAX pass; same document marker |

## To check next

- Search, sorting, and paging variations across list pages.
- Configuration saves and other state-changing form submissions using the test account.
- Native file upload/download and production account behavior.

The sandbox intermittently returned HTTP 500 or bounced to Login after repeated sign-ins during the audit. Those attempts were not counted as PJAX passes or route failures. A fresh test-profile cookie session restored normal navigation.
