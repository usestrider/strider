---
"@usestrider/browser": patch
---

Scroll pointer-action targets into view when an ancestor scroller in the target or a parent document wholly clips them, even when their rectangles intersect the document viewport. Overlay coverage and non-scrollable clipping alone still do not scroll; explicit positions and individual check overrides retain their behavior.

On Firefox and stock WebKit, mouse and touch pointer moves are sent at the exact point an action picks rather than rounded to whole pixels. The new capability `input.fractionalPointer` says whether a browser delivers that point exactly: Chromium does; Firefox delivers pointer events at the nearest whole pixel, up to half a pixel away, and WebKit truncates to a whole pixel, less than a pixel away.
