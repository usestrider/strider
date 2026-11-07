---
"@usestrider/vitest": patch
"@usestrider/browser": patch
---

Add opt-in failure tracing to the Vitest browser layer. Bound callbacks record their own contexts, export and attach failed attempts with captured test identity, and release recordings without retaining successful-test artifacts. Adapter capture defaults enable per-action screenshots, DOM snapshots and network while direct trace recording defaults remain unchanged. Preserve experimental browser operations through decorated browser services.
