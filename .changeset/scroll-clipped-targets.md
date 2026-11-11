---
"@usestrider/browser": patch
---

Scroll pointer-action targets into view when an ancestor scroller wholly clips them, even when their rectangles intersect the document viewport. Overlay coverage alone still does not scroll; explicit positions and individual check overrides retain their behavior.
