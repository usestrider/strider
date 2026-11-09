---
"@usestrider/browser": patch
---

Add readonly Locator.boundingBox reads of browser-derived axis-aligned rects in top-level viewport CSS pixels, composed through frames, with an Option result for elements without layout boxes. Reads are strict and immediate and do not scroll or send input.

Stock browser defaults are unchanged. Firefox supports positive axis-aligned frame scaling, CSS zoom and translation; frame rotation, skew, reflection, 3D, perspective and motion paths fail with descriptive typed Unsupported. Target rects follow the browser's transforms and camera clipping without reconstructing original corners.
