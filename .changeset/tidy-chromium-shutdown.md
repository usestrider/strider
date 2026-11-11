---
"@usestrider/browser": patch
---

Attempt graceful shutdown of successfully connected Chromium launches before signal termination, helping preserve recent supplied-profile storage on a best-effort basis. Wait up to five additional seconds for process exit; a hung Chromium can take roughly ten seconds plus process-group cleanup.
