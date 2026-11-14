---
"@usestrider/browser": patch
---

Fix viewports on Chromium pages with a cross-site iframe. The viewport is now applied, measured and cleared on top-level pages only: an out-of-process iframe no longer stays paused while Strider measures it, so the page loads, and `page.emulate({ viewport })`, `strider page viewport`, and closing a context with a viewport no longer fail with "Command can only be executed on top-level targets". A rejected CDP command's `Protocol.Rejected` now has an optional `target` naming the kind of target it was sent to.
