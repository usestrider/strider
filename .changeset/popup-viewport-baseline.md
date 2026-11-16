---
"@usestrider/browser": patch
---

Release a viewport promptly on Chromium while a popup opened under it is open. A popup that opens as a tab, such as one a `target=_blank` link opens, recorded its opener's emulated size as its own, so releasing the viewport waited 30 seconds for a size the tab never returned to, then logged a warning. A popup that shares its window with another page now records that page's size, and its restore confirms once it's back at it. Any other popup, such as a `window.open` popup window or a tab alone in a new window, has no size to compare with, so its restore logs that it couldn't be verified instead of waiting.
