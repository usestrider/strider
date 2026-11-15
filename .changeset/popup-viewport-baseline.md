---
"@usestrider/browser": patch
---

Release a viewport promptly on Chromium while a popup opened under it is open. A popup that opens as a tab, such as one a `target=_blank` link opens, recorded its opener's emulated size as its own, so releasing the viewport waited 30 seconds for a size the tab never returned to, then logged a warning. A tab now records the size of another page in its window, and its restore confirms once it's back at that size. A popup window that `window.open` opens keeps the size it measures. A tab that opens alone in a new window has no size to compare with, so its restore logs that it couldn't be verified instead of waiting.
