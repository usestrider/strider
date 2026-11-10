---
"@usestrider/browser": patch
---

A scope that owns many pages in a context now closes them together as it ends, instead of one after another, so ending a context with twenty pages takes about one close rather than twenty.
