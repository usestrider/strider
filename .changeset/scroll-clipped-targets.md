---
"@usestrider/browser": patch
---

Scroll pointer-action targets into view when an ancestor scroller in the target or a parent document wholly clips them, even when their rectangles intersect the document viewport. Overlay coverage and non-scrollable clipping alone still do not scroll; explicit positions and individual check overrides retain their behavior.
