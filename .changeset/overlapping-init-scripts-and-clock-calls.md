---
"@usestrider/browser": patch
---

Init scripts declared at the same time on one Chromium page no longer fail with "Script not found" or leave a replaced script running in later documents, and calls on one page clock that run at the same time, such as `adjust` beside `setTime`, now take turns, each replacing the clock's script for later documents instead of leaving one behind (#341).
