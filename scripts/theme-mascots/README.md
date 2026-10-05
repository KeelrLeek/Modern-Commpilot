# Selected mascot theme icons

These 24 standalone SVGs are the user's choices from the October 5, 2026 icon gallery. `selections.json` records each theme, design name and A/B/C choice.

`node scripts/make-theme-marks.cjs` copies these masters into `assets/icons/theme-<palette>.svg`. The release build calls that script, so rebuilding preserves the selections. Original generated drawings remain as a fallback for future themes without a selected mascot.

Each light and dark master is a source-contour conversion of its ImageGen mockup, with solid fills and smooth cubic curves. Small facial features use tighter curve-fitting tolerances. The gallery's prompts and source comparisons are preserved at `release/previews/theme-icon-options/` in the parent project.

To replace a selection later, update its two masters and its entry in `selections.json`, then regenerate and rebuild. Only the generated production icons are packaged; this master directory is a development input.
