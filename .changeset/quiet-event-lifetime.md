---
"@usestrider/browser": patch
---

Make one-shot event waits keep their first terminal outcome. Target end fails unfinished waits with `TargetGone` independently of delivery or predicate progress, including registration against an ended target. Scope closure cancels unfinished waits without draining queued events, completed results remain latched, and completed subscriptions release their buffers and internal finalizers.

This is a patch for the unstable event APIs: it restores the documented target-end guarantee and scope lifetime without changing signatures, options, defaults or valid completed results. A late success or timeout after the target ended was outside that guarantee and now becomes `TargetGone`.
