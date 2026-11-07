---
"@usestrider/browser": patch
---

Defer operation caller stack formatting until trace source export or failure rendering, reducing the cost of operations without recording while preserving construction-time caller locations.
