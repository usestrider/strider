---
"@usestrider/browser": patch
---

Release a viewport promptly on Chromium while a popup opened under it is open. A popup that opens as a tab of its opener's window, such as one a `target=_blank` link opens, recorded its opener's emulated size as its own, so releasing the viewport waited 30 seconds for a size the popup never returned to, then logged a warning. It now records its opener's own size, and its restore confirms once the popup is back at it.
