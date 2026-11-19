---
"@usestrider/browser": patch
---

Add `browser.contexts`, the browser's contexts kept up to date as they open and close: the default context first, then
the others in the order they were added. A context this connection created is the `UserContext` that `newContext`
returned; any other is an observed context with `control`. Connecting to a running Chromium or Firefox lists the
contexts it already has, empty ones too.
