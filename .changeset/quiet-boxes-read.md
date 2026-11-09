---
"@usestrider/browser": patch
---

Add readonly Locator.boundingBox reads in main-frame viewport CSS pixels, including transformed and zoomed nested frames, with an Option result for elements without layout boxes.

Firefox CSS motion paths and some camera-clipped normal-flow geometry remain unsupported.
