---
"@usestrider/vitest": patch
"@usestrider/browser": patch
---

Add opt-in failure tracing to the Vitest browser layer. Bound callbacks record their own contexts, export and attach failed attempts with captured test identity, and release recordings without retaining successful-test artifacts. Adapter capture defaults enable per-action screenshots, DOM snapshots and network while direct trace recording defaults remain unchanged. Preserve experimental browser operations through decorated browser services.

Capture Vitest repeat identity separately from retries in `TestInfo.repeat`, trace metadata and archive filenames, so later repeats cannot overwrite or delete earlier traces. The repeat field remains optional for existing structural identity objects, and missing values default to zero for constructors and decoding; repeat-zero filenames keep their previous names.
