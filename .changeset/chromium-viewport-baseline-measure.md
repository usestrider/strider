---
"@usestrider/browser": patch
---

On Chromium, releasing a viewport on a page that stays open no longer waits 30 seconds and warns that the renderer did not restore the viewport dimensions. A page created under a viewport now records its original size as the restore checks it, from `innerWidth` and `innerHeight`, so the check passes at a fractional device scale and with a scrollbar. Where the browser answers that reading only after the viewport applies, as the headless shell does, the reading shows the viewport in its size or, for a mobile viewport, its screen: the original size is then unknown, and releasing the viewport warns that the restore could not be verified instead of waiting.
