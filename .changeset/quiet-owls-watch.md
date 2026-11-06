---
"@usestrider/browser": patch
---

Capture a screenshot when a page-associated expectation succeeds or fails with trace screenshots set to "perAction", including after its deadline expires. Give each completion capture its own fixed one-second browser-clock budget; omit failed or timed-out captures while preserving the original operation result. Keep screenshots off by default and DOM snapshots limited to actions and navigation.
