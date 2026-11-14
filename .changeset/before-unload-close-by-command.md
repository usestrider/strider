---
"@usestrider/browser": patch
---

A page closed with `page.close({ runBeforeUnload: true })` now ends with `PageClosed` whose `by` is `"command"` on Chromium and Firefox, when its `beforeunload` prompt is accepted or it has none, instead of `"script"`. A refused prompt still fails the close with `CloseCanceled` and leaves the page open, and the page's own later close still reports `"script"`.
