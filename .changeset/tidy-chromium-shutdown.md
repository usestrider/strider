---
"@usestrider/browser": patch
---

Closing `Chromium.layer` now closes the browser it launched cleanly to preserve recent writes to a supplied `userDataDir`. If the browser does not exit within five seconds, Strider stops it.
