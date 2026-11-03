---
"@usestrider/browser": patch
"@usestrider/vitest": patch
"@usestrider/cli": patch
---

Publish the current build. 0.1.0's `dist` was out of date against its `src`: among other things it lacked the `Operation` module and the `experimental` entry point, so use this version instead.
