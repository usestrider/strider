---
"@usestrider/browser": patch
---

Response body subscriptions (`NetworkResponse.next` and `stream` with `body`) now end, and cancel any body read in progress, when borrowed inspect access is released. An expired grant fails with `TargetGone`.
