---
"@usestrider/browser": patch
---

Add `Popup.opener`, the page that opened a popup: `Option.none()` for a page no page opened and once its opener closed, the opener still after it crashed, and `Unsupported` on WebKit, which names no opener. Pages an attached browser already had name their opener too.
