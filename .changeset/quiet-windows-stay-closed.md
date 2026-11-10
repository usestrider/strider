---
"@usestrider/browser": minor
---

A Chromium launch on a temporary profile now starts without a window, as Playwright's does, so `browser.defaultContext.pages` is empty after launch until `newPage` opens a page, and the `strider tabs` command and the `tabs` tool list nothing until a page exists. Launching is about a third faster. A launch with `userDataDir` keeps its `about:blank` page, and `args: ["--no-startup-window"]` is no longer needed.
