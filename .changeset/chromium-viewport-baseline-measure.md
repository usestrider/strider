---
"@usestrider/browser": patch
---

On Chromium, releasing a viewport on a page that stays open no longer waits 30 seconds and warns that the renderer did not restore the viewport dimensions. A page Strider opens under a viewport now records its original size the same way the restore checks it, before the viewport is applied, so the check passes at a fractional device scale and in the headless shell. A page another client opens at a URL in the context records an unknown size, so releasing its viewport warns that the restore could not be verified instead of waiting.
