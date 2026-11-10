---
"@usestrider/browser": patch
---

Fix Chromium popups opened without an opener staying at about:blank. Install declarations before resuming new pages, while allowing their first routed request to complete during initialization.
