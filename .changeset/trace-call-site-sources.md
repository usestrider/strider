---
"@usestrider/browser": patch
---

Add caller locations and local source files to trace archives so the Playwright viewer can link steps to source lines. Sources are read at export time and included unchanged under every diagnostics preset; unreadable files are omitted.
