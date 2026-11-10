---
"@usestrider/browser": patch
---

Stop CLI and toolkit sessions from keeping a navigation in memory, for as long as the page stays open, when another call running at the same time already reported it.
