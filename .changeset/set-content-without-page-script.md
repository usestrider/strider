---
"@usestrider/browser": patch
---

On Chromium, `page.setContent` now waits for `load` or `domContentLoaded` through what the browser reports of the replaced document, instead of a listener it added to the page, so it settles in a context with JavaScript disabled, where it used to time out. A timed-out call's diagnostics there report no cleanup, since nothing is left in the page, and a navigation during the wait ends it. Firefox and stock WebKit don't report the replacement, and Strider can't turn JavaScript off on them through emulation (`emulation.javaScript.disabled` is unsupported there), so `setContent` keeps its listener and its cleanup there.
