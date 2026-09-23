# CommPilot PJAX route audit

Live sandbox account, Edge with the unpacked 0.3.5 extension. A **PJAX pass** means the destination rendered with HTTP 200 and the top-level document marker stayed the same. Opening a form here does not submit or save it. The visual, live-updating tally is at `dev-preview/pjax-route-audit.html`; this note preserves the first walkthrough only. The current extension build is 0.3.6.

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

- Reseller and service-provider drill-in pages, including device management and administrators.
- Other Group and User settings branches and their nested forms.
- List find/sort/page actions outside Users and Groups.
- Native file upload/download, login/logout, and any route whose server response has no app content cell.

The sandbox intermittently returned HTTP 500 or bounced to Login after repeated sign-ins during the audit. Those attempts were not counted as PJAX passes or route failures. A fresh test-profile cookie session restored normal navigation.
