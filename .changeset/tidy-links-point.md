---
"@usestrider/browser": patch
---

Fix default pointer actions on wrapped and partly offscreen elements by aiming at the first nonempty client rectangle clipped to the viewport. Keep integer-rounded coordinates inside that rectangle when possible. Explicit positions continue to measure from the padding-box origin.
