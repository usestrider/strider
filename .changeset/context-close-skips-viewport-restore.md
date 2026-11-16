---
"@usestrider/browser": patch
---

Closing a Chromium context made with `emulation` (from `Browser.newContext` or `Browser.newPage`) no longer undoes its emulation before the context is removed. The viewport restore that undo ran waited up to 30 seconds and logged `Failed to release CDP declaration` whenever the renderer never reported its original size, as with a page blocked by a script, headed Chromium, or the headless shell. A context handed off and left open, and `page.emulate` or `context.emulate` released with their scope, still restore.
