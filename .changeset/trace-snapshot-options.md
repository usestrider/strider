---
"@usestrider/browser": patch
---

Make `Trace.Options` refuse `domSnapshots: true` without `network: true` at compile time. Options are now `CaptureOptions & (NetworkOptions | SnapshotOptions)`; options built from a computed flag choose a branch, as in `flag ? { domSnapshots: true, network: true } : {}`.
