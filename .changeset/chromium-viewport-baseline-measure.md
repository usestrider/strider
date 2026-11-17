---
"@usestrider/browser": patch
---

On Chromium, releasing a viewport on a page that stays open no longer waits 30 seconds and warns that the renderer did not restore the viewport dimensions. A page Strider opens under a viewport now records its original size the same way the restore checks it, before the viewport is applied, so the check passes at a fractional device scale. A page created while a viewport is in force that starts at a URL, such as one another client opens in a context Strider created, records an unknown size, as does every page the headless shell creates under a viewport, since it reports no URL for a new page: releasing the viewport no longer records the viewport's own size or waits, but warns that the restore could not be verified. A page given its viewport after it opened, or one already open when Strider connects, is measured and its restore confirmed as before.
