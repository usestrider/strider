---
"@usestrider/browser": patch
---

Wait for Chromium's mouse press to complete before releasing a click, so a dialog opened by mousedown cannot discard mouseup and click. Preserve release cleanup when the press wait fails or is interrupted.
