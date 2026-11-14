---
"@usestrider/browser": patch
---

Scroll pointer-action targets into view when an ancestor scroller in the target or a parent document wholly clips them, even when their rectangles intersect the document viewport. Overlay coverage and non-scrollable clipping alone still do not scroll; explicit positions and individual check overrides retain their behavior.

On Firefox, pointer moves are sent at the exact point an action picks rather than rounded to whole pixels, and the new capability `input.fractionalPointer` says whether a browser delivers that point exactly; Firefox delivers pointer events at whole pixels, up to half a pixel away.
