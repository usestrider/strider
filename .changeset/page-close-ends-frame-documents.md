---
"@usestrider/browser": patch
---

Closing a page now ends the documents of its frames as well as its own, so a wait on a frame's document, such as a fill's guard cleanup, finishes at once instead of running to its deadline.
