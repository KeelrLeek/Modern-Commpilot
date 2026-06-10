# Raw help-topic source (dev-only)

Drop the legacy BroadWorks help `.htm` files here. These are **source material**
for authoring `assets/help/help-content.json` — they are NOT shipped and are NOT
referenced by the manifest / `web_accessible_resources`.

Each legacy page declares its own help topic via a JS variable, e.g.:

    var helpFile = "/commpilot/Help/en_US/RA/RA_Reseller_Groups.htm";

To capture one: open that URL on the live portal (or click the legacy **Help**
link on the page) and save the page as `.htm` into this folder.

Workflow: the advisor condenses each topic into concise, **paraphrased** entries
(page-level → `byName`/`byText`, per-field → `byField`). Vendor help text is a
reference only — never copied verbatim (Cisco/BroadWorks proprietary).
