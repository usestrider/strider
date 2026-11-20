---
"@usestrider/browser": patch
---

Add `browser.contexts`, the browser's contexts kept up to date as they open and close: the default context first, then
the others in the order they were added. A context this connection created is the `UserContext` that `newContext`
returned; any other is an observed context with `control`. Connecting to a running Chromium or Firefox lists the
contexts it already has, empty ones too.

A `newContext` that fails on Chromium after the browser has made its context, including one that times out, now
attempts to remove that context within five seconds. If the browser refuses the removal, the context stays open and
`browser.contexts` lists it as an observed context.
