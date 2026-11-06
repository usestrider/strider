---
"@usestrider/browser": patch
---

Include failed expectations' observations, check count, elapsed time, nearest match and suggestions in exported trace error messages so trace viewers display the failure evidence.

Record page URL expectations in their page's trace. Apply the diagnostics preset at each export to expected and observed URLs, hide titles under strict, and strip classified form values under both presets without changing the caller's failure.
