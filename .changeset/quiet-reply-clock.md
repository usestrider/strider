---
"@usestrider/browser": patch
---

Recheck protocol reply deadlines on the monotonic browser clock so an early timer does not let a resolving Timeout escape an inherited expectation deadline.
