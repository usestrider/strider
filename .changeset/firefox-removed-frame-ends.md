---
"@usestrider/browser": patch
---

On Firefox, a removed cross-site iframe now leaves `page.frames` even when Firefox doesn't send its `browsingContext.contextDestroyed`, which Firefox 158 sometimes loses when the iframe's process has already exited.
